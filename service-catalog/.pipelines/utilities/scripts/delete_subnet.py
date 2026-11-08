import argparse
import ipaddress
# from azure.identity import DefaultAzureCredential  # local testing
from azure.identity import ClientSecretCredential
from azure.mgmt.network import NetworkManagementClient
import os

AZURE_CLIENT_ID = os.environ["ARM_CLIENT_ID"]
AZURE_TENANT_ID = os.environ["ARM_TENANT_ID"]
AZURE_CLIENT_SECRET = os.environ["ARM_CLIENT_SECRET"]

def delete_subnet(subscription_id, resource_group, vnet_name, subnet_name):
    """Automatically create a new subnet in the VNet"""
    # credential = DefaultAzureCredential() #local testing
    credential = ClientSecretCredential(
        client_id = AZURE_CLIENT_ID,
        tenant_id = AZURE_TENANT_ID,
        client_secret = AZURE_CLIENT_SECRET,
    )
    network_client = NetworkManagementClient(credential, subscription_id)

    print(f"🚀 Deleting subnet '{subnet_name}' ")
    subnet_result = network_client.subnets.begin_delete(
        resource_group,
        vnet_name,
        subnet_name

    ).result()

    print(f"✅ Subnet '{subnet_name}' deleted successfully!")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Delete a subnet in an Azure VNet.")
    parser.add_argument("--subscription_id", required=True, help="Azure Subscription ID")
    parser.add_argument("--resource_group", required=True, help="Azure Resource Group Name")
    parser.add_argument("--vnet_name", required=True, help="Azure Virtual Network Name")
    parser.add_argument("--subnet_name", help="Subnet Name to be Deleted (Optional)")

    args = parser.parse_args()

    # Strip trailing commas and whitespace
    subscription_id = args.subscription_id.strip().rstrip(",")
    resource_group = args.resource_group.strip().rstrip(",")
    vnet_name = args.vnet_name.strip().rstrip(",")

    # If no subnet_name is provided, just list available ranges
    if not args.subnet_name:
        print("\n✅ Found No Subnets to be Deleted")
    else:
        # Delete a subnet
        subnet_name = args.subnet_name.strip().rstrip(",")
        if subnet_name:
            print(f"\n✅ Suggested subnet to be deleted {subnet_name}")
            delete_subnet(subscription_id, resource_group, vnet_name, subnet_name)
        else:
            print("\n❌ No available subnet found to be deleted")
