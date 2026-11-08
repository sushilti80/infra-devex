import argparse
import ipaddress
# from azure.identity import DefaultAzureCredential  # local testing
from azure.identity import ClientSecretCredential
from azure.mgmt.network import NetworkManagementClient
import os

AZURE_CLIENT_ID = os.environ["ARM_CLIENT_ID"]
AZURE_TENANT_ID = os.environ["ARM_TENANT_ID"]
AZURE_CLIENT_SECRET = os.environ["ARM_CLIENT_SECRET"]

def get_available_ip_ranges(subscription_id, resource_group, vnet_name):
    """Fetch available IP ranges inside an Azure VNet"""
    # credential = DefaultAzureCredential() #local testing
    credential = ClientSecretCredential(
        client_id = AZURE_CLIENT_ID,
        tenant_id = AZURE_TENANT_ID,
        client_secret = AZURE_CLIENT_SECRET,
    )
    network_client = NetworkManagementClient(credential, subscription_id)

    # Get VNet address space
    vnet = network_client.virtual_networks.get(resource_group, vnet_name)
    vnet_cidrs = [ipaddress.ip_network(cidr) for cidr in vnet.address_space.address_prefixes]

    # Get existing subnets
    subnets = network_client.subnets.list(resource_group, vnet_name)
    subnet_cidrs = [ipaddress.ip_network(subnet.address_prefix) for subnet in subnets]

    # Filter subnets that are actually inside the VNet
    valid_subnet_cidrs = []
    for subnet_cidr in subnet_cidrs:
        if any(subnet_cidr.subnet_of(vnet_cidr) or subnet_cidr in vnet_cidrs for vnet_cidr in vnet_cidrs):
            valid_subnet_cidrs.append(subnet_cidr)
        else:
            print(f"⚠️ Skipping {subnet_cidr}, as it is not inside the VNet CIDR range {vnet_cidrs}")

    # Calculate available IP ranges
    available_ranges = vnet_cidrs[:]
    for subnet_cidr in valid_subnet_cidrs:
        temp_ranges = []
        for available_range in available_ranges:
            if subnet_cidr.subnet_of(available_range) or subnet_cidr in available_range:
                temp_ranges.extend(available_range.address_exclude(subnet_cidr))
            else:
                temp_ranges.append(available_range)
        available_ranges = temp_ranges

    return available_ranges

def suggest_best_subnet_size(available_ranges, desired_prefix="/24"):
    """Suggest the best available subnet size"""
    desired_cidr = int(desired_prefix.strip("/"))

    for range in available_ranges:
        for new_prefix in range.subnets(new_prefix=desired_cidr):
            return str(new_prefix)  # Return the best available subnet

    print("⚠️ No available range found for /24, trying smaller subnets...")

    for smaller_cidr in [25, 26, 27]:
        for range in available_ranges:
            for new_prefix in range.subnets(new_prefix=smaller_cidr):
                return str(new_prefix)

    print("❌ No available subnet found.")
    return None

def subnet_exists(network_client, resource_group, vnet_name, subnet_name):
    """Check if a subnet already exists"""
    try:
        network_client.subnets.get(resource_group, vnet_name, subnet_name)
        return True
    except Exception as e:
        if "NotFound" in str(e) or "ResourceNotFound" in str(e):
            return False
        raise  # Unexpected error

def create_subnet(subscription_id, resource_group, vnet_name, subnet_name, subnet_cidr):
    """Automatically create a new subnet in the VNet, if it does not exist"""
    credential = ClientSecretCredential(
        client_id = AZURE_CLIENT_ID,
        tenant_id = AZURE_TENANT_ID,
        client_secret = AZURE_CLIENT_SECRET,
    )
    network_client = NetworkManagementClient(credential, subscription_id)

    if subnet_exists(network_client, resource_group, vnet_name, subnet_name):
        print(f"⚠️ Subnet '{subnet_name}' already exists. Skipping creation.")
        return

    subnet_params = {
        "address_prefix": subnet_cidr,
        "delegations": [
            {
                "name": "Microsoft.Web/serverFarms",
                "service_name": "Microsoft.Web/serverFarms",
            }
        ]
    }

    print(f"🚀 Creating subnet '{subnet_name}' with CIDR {subnet_cidr}...")
    subnet_result = network_client.subnets.begin_create_or_update(
        resource_group,
        vnet_name,
        subnet_name,
        subnet_params
    ).result()

    print(f"✅ Subnet '{subnet_name}' created successfully with address {subnet_cidr}!")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Find available IP ranges and create a subnet in an Azure VNet.")
    parser.add_argument("--subscription_id", required=True, help="Azure Subscription ID")
    parser.add_argument("--resource_group", required=True, help="Azure Resource Group Name")
    parser.add_argument("--vnet_name", required=True, help="Azure Virtual Network Name")
    parser.add_argument("--subnet_name", help="Subnet Name to be Created (Optional)")
    parser.add_argument("--desired_prefix", default="/24", help="Desired CIDR Prefix for the new subnet (default: /24)")

    args = parser.parse_args()

    # Strip trailing commas and whitespace
    subscription_id = args.subscription_id.strip().rstrip(",")
    resource_group = args.resource_group.strip().rstrip(",")
    vnet_name = args.vnet_name.strip().rstrip(",")
    desired_prefix = args.desired_prefix.strip().rstrip(",")

    # Fetch available IPs
    available_ips = get_available_ip_ranges(subscription_id, resource_group, vnet_name)

    # If no subnet_name is provided, just list available ranges
    if not args.subnet_name:
        print("\n✅ Available IP Ranges for new subnets:")
        for range in available_ips:
            print(range)
        print("\n💡 Pass `--subnet_name <subnet_name>` to automatically create a subnet.")
    else:
        # Create a subnet
        subnet_name = args.subnet_name.strip().rstrip(",")
        best_subnet = suggest_best_subnet_size(available_ips, desired_prefix)

        if best_subnet:
            print(f"\n✅ Suggested subnet CIDR: {best_subnet}")
            create_subnet(subscription_id, resource_group, vnet_name, subnet_name, best_subnet)
        else:
            print("\n❌ No available subnet found for the requested size.")
