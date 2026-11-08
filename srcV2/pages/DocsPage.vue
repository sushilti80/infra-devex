<script setup lang="ts">
import { ref } from 'vue'
import { useNavigationStore } from '../stores/navigation'
import { useEnvironmentsStore } from '../stores/environments'

const navigationStore = useNavigationStore()
const environmentsStore = useEnvironmentsStore()

const activeSection = ref('overview')

function scrollToSection(sectionId: string) {
  activeSection.value = sectionId
  const element = document.getElementById(sectionId)
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <!-- Header -->
      <div class="mb-8">
        <button
          type="button"
          class="mb-4 inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          @click="navigationStore.navigateToPage('home')"
        >
          <span class="material-symbols-outlined text-lg mr-2">arrow_back</span>
          Back to Home
        </button>

        <div class="flex items-center gap-3 mb-4">
          <span class="material-symbols-outlined text-4xl text-blue-600 dark:text-blue-400">
            menu_book
          </span>
          <h1 class="text-4xl font-bold text-gray-900 dark:text-white">
            QuickStart Guide
          </h1>
        </div>
        <p class="text-lg text-gray-600 dark:text-gray-400">
          Learn how to use the Self-Service Infrastructure Catalog to provision and manage Azure sandbox resources. Once your application is ready for enterprise, it can be migrated to the Infrastrive-live cadence.
        </p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <!-- Sidebar Navigation -->
        <aside class="lg:col-span-1">
          <div class="sticky top-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <h2 class="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide mb-3">
              On This Page
            </h2>
            <nav class="space-y-1">
              <a
                href="#overview"
                :class="[
                  'block px-3 py-2 rounded-lg text-sm transition-colors',
                  activeSection === 'overview'
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                ]"
                @click.prevent="scrollToSection('overview')"
              >
                Overview
              </a>
              <a
                href="#getting-started"
                :class="[
                  'block px-3 py-2 rounded-lg text-sm transition-colors',
                  activeSection === 'getting-started'
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                ]"
                @click.prevent="scrollToSection('getting-started')"
              >
                Getting Started
              </a>
              <a
                href="#custom-infrastructure"
                :class="[
                  'block px-3 py-2 rounded-lg text-sm transition-colors',
                  activeSection === 'custom-infrastructure'
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                ]"
                @click.prevent="scrollToSection('custom-infrastructure')"
              >
                Custom Infrastructure
              </a>
              <a
                href="#template-deploy"
                :class="[
                  'block px-3 py-2 rounded-lg text-sm transition-colors',
                  activeSection === 'template-deploy'
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                ]"
                @click.prevent="scrollToSection('template-deploy')"
              >
                Template Deploy
              </a>
              <a
                href="#aks-deploy"
                :class="[
                  'block px-3 py-2 rounded-lg text-sm transition-colors',
                  activeSection === 'aks-deploy'
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                ]"
                @click.prevent="scrollToSection('aks-deploy')"
              >
                AKS Playground
              </a>
              <a
                href="#installed-apps"
                :class="[
                  'block px-3 py-2 rounded-lg text-sm transition-colors',
                  activeSection === 'installed-apps'
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                ]"
                @click.prevent="scrollToSection('installed-apps')"
              >
                Installed Apps
              </a>
              <a
                v-if="environmentsStore.shipEnabled"
                href="#ship-from-repo"
                :class="[
                  'block px-3 py-2 rounded-lg text-sm transition-colors',
                  activeSection === 'ship-from-repo'
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                ]"
                @click.prevent="scrollToSection('ship-from-repo')"
              >
                Ship from Repo
              </a>
              <a
                href="#existing-infra"
                :class="[
                  'block px-3 py-2 rounded-lg text-sm transition-colors',
                  activeSection === 'existing-infra'
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                ]"
                @click.prevent="scrollToSection('existing-infra')"
              >
                Existing Infra
              </a>
              <a
                href="#feedback"
                :class="[
                  'block px-3 py-2 rounded-lg text-sm transition-colors',
                  activeSection === 'feedback'
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                ]"
                @click.prevent="scrollToSection('feedback')"
              >
                Request Feature / Bug
              </a>
            </nav>
          </div>
        </aside>

        <!-- Main Content -->
        <main class="lg:col-span-3">
          <div class="prose prose-blue dark:prose-invert max-w-none">
            <!-- Overview Section -->
            <section id="overview" class="mb-12 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <span class="material-symbols-outlined text-3xl text-blue-600">info</span>
                Overview
              </h2>
              <p class="text-gray-700 dark:text-gray-300 mb-4">
                The Self-Service Infrastructure Catalog is a centralized platform for provisioning, deploying, and managing Azure sandbox infrastructure resources. It simplifies the process of creating cloud resources by providing pre-configured modules and templates for rapid development and testing.
              </p>
              <div class="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 mb-4">
                <div class="flex items-start gap-2">
                  <span class="material-symbols-outlined text-amber-600 dark:text-amber-400 text-xl mt-0.5">info</span>
                  <div>
                    <p class="text-sm text-amber-900 dark:text-amber-200 font-semibold mb-1">Sandbox Environment</p>
                    <p class="text-sm text-amber-800 dark:text-amber-300">
                      This platform is designed for sandbox (sand) environment deployments. Once your application is ready for enterprise production, it can be migrated to the <strong>Infrastrive-live cadence</strong> for full lifecycle management.
                    </p>
                  </div>
                </div>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                <div class="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <h3 class="text-lg font-semibold text-blue-900 dark:text-blue-200 mb-2">Key Benefits</h3>
                  <ul class="space-y-2 text-sm text-blue-800 dark:text-blue-300">
                    <li class="flex items-start gap-2">
                      <span class="material-symbols-outlined text-lg">check_circle</span>
                      <span>Self-service infrastructure provisioning</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <span class="material-symbols-outlined text-lg">check_circle</span>
                      <span>Pre-configured Terraform modules</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <span class="material-symbols-outlined text-lg">check_circle</span>
                      <span>Automated deployment workflows</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <span class="material-symbols-outlined text-lg">check_circle</span>
                      <span>GitOps-based infrastructure management</span>
                    </li>
                  </ul>
                </div>
                <div class="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                  <h3 class="text-lg font-semibold text-green-900 dark:text-green-200 mb-2">Use Cases</h3>
                  <ul class="space-y-2 text-sm text-green-800 dark:text-green-300">
                    <li class="flex items-start gap-2">
                      <span class="material-symbols-outlined text-lg">rocket_launch</span>
                      <span>Rapid sandbox provisioning</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <span class="material-symbols-outlined text-lg">rocket_launch</span>
                      <span>Standardized infrastructure patterns</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <span class="material-symbols-outlined text-lg">rocket_launch</span>
                      <span>Development and testing environments</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <span class="material-symbols-outlined text-lg">rocket_launch</span>
                      <span>Migration path to enterprise production</span>
                    </li>
                  </ul>
                </div>
              </div>
            </section>

            <!-- Getting Started Section -->
            <section id="getting-started" class="mb-12 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <span class="material-symbols-outlined text-3xl text-green-600">play_circle</span>
                Getting Started
              </h2>
              <div class="space-y-6">
                <div>
                  <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-3">Prerequisites</h3>
                  <ul class="space-y-2 text-gray-700 dark:text-gray-300">
                    <li class="flex items-start gap-3">
                      <span class="material-symbols-outlined text-blue-600 dark:text-blue-400 mt-0.5">check</span>
                      <span><strong>Microsoft Entra ID Account:</strong> You need a valid work account to access the platform</span>
                    </li>
                    <li class="flex items-start gap-3">
                      <span class="material-symbols-outlined text-blue-600 dark:text-blue-400 mt-0.5">check</span>
                      <span><strong>Basic Understanding:</strong> Familiarity with Azure services and cloud infrastructure concepts</span>
                    </li>
                  </ul>
                  <div class="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                    <p class="text-sm text-blue-800 dark:text-blue-300">
                      <strong>Note:</strong> Azure permissions will be handled by the DevOps team during the PR approval process. You don't need direct Azure access to use this platform.
                    </p>
                  </div>
                </div>
                <div class="p-6 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                  <h3 class="text-lg font-semibold text-yellow-900 dark:text-yellow-200 mb-2 flex items-center gap-2">
                    <span class="material-symbols-outlined">lightbulb</span>
                    Quick Start Steps
                  </h3>
                  <ol class="space-y-3 text-yellow-800 dark:text-yellow-300">
                    <li class="flex items-start gap-3">
                      <span class="flex-shrink-0 w-6 h-6 bg-yellow-600 dark:bg-yellow-700 text-white rounded-full flex items-center justify-center text-sm font-bold">1</span>
                      <span><strong>Sign In:</strong> Click "Sign in with Microsoft" on the home page</span>
                    </li>
                    <li class="flex items-start gap-3">
                      <span class="flex-shrink-0 w-6 h-6 bg-yellow-600 dark:bg-yellow-700 text-white rounded-full flex items-center justify-center text-sm font-bold">2</span>
                      <span><strong>Choose Feature:</strong> Select Custom Infrastructure, Template Deploy, or AKS Playground</span>
                    </li>
                    <li class="flex items-start gap-3">
                      <span class="flex-shrink-0 w-6 h-6 bg-yellow-600 dark:bg-yellow-700 text-white rounded-full flex items-center justify-center text-sm font-bold">3</span>
                      <span><strong>Configure:</strong> Fill in required details for your infrastructure</span>
                    </li>
                    <li class="flex items-start gap-3">
                      <span class="flex-shrink-0 w-6 h-6 bg-yellow-600 dark:bg-yellow-700 text-white rounded-full flex items-center justify-center text-sm font-bold">4</span>
                      <span><strong>Deploy:</strong> Submit and monitor the automated provisioning process</span>
                    </li>
                  </ol>
                </div>
              </div>
            </section>

            <!-- Custom Infrastructure Section -->
            <section id="custom-infrastructure" class="mb-12 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <span class="material-symbols-outlined text-3xl text-purple-600">construction</span>
                Custom Infrastructure
              </h2>

              <p class="text-gray-700 dark:text-gray-300 mb-6">
                Build custom infrastructure solutions by composing reusable Terraform modules. This feature generates Terraform infrastructure code based on your selections and creates a GitHub Pull Request for review and approval.
              </p>

              <div class="mb-6 p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg border-l-4 border-orange-500 dark:border-orange-600">
                <div class="flex items-start gap-3">
                  <span class="material-symbols-outlined text-orange-600 dark:text-orange-400 text-2xl">info</span>
                  <div>
                    <h4 class="font-semibold text-orange-900 dark:text-orange-200 mb-1">PR Approval Required</h4>
                    <p class="text-sm text-orange-800 dark:text-orange-300">
                      This workflow generates infrastructure code and creates a Pull Request in GitHub. A <strong>Principal Engineer or DevOps team member</strong> must review and approve the PR before the infrastructure is provisioned. This ensures code quality and compliance with organizational standards.
                    </p>
                  </div>
                </div>
              </div>

              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-3">How to Use</h3>
              <div class="space-y-4 mb-6">
                <div class="flex gap-4">
                  <div class="flex-shrink-0 w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
                    <span class="text-purple-600 dark:text-purple-400 font-bold">1</span>
                  </div>
                  <div>
                    <h4 class="font-semibold text-gray-900 dark:text-white mb-1">Enter Project Details</h4>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                      Provide a project abbreviation (max 8 characters, lowercase), service name, owner email, and select target environment (devsand, sand, stg, prod).
                    </p>
                  </div>
                </div>
                <div class="flex gap-4">
                  <div class="flex-shrink-0 w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
                    <span class="text-purple-600 dark:text-purple-400 font-bold">2</span>
                  </div>
                  <div>
                    <h4 class="font-semibold text-gray-900 dark:text-white mb-1">Select Modules</h4>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                      Choose from available Terraform modules (e.g., Azure App Service, Azure SQL, Storage Account, Key Vault). Add multiple modules as needed.
                    </p>
                  </div>
                </div>
                <div class="flex gap-4">
                  <div class="flex-shrink-0 w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
                    <span class="text-purple-600 dark:text-purple-400 font-bold">3</span>
                  </div>
                  <div>
                    <h4 class="font-semibold text-gray-900 dark:text-white mb-1">Standard Sandbox Configuration</h4>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                      Modules are provisioned with standard sandbox values (SKU, region, size, etc.). If you need to modify or upgrade these values, work with a Principal Engineer or DevSecOps team for custom configurations.
                    </p>
                  </div>
                </div>
                <div class="flex gap-4">
                  <div class="flex-shrink-0 w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
                    <span class="text-purple-600 dark:text-purple-400 font-bold">4</span>
                  </div>
                  <div>
                    <h4 class="font-semibold text-gray-900 dark:text-white mb-1">Submit & Wait for Approval</h4>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                      Submit the request to generate Terraform code and create a GitHub PR. A Principal Engineer or DevOps team member will review the PR. Once approved and merged, the automated workflow provisions your infrastructure.
                    </p>
                  </div>
                </div>
              </div>

              <div class="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                <h4 class="font-semibold text-purple-900 dark:text-purple-200 mb-2">Available Modules</h4>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-purple-800 dark:text-purple-300">
                  <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-lg">cloud</span>
                    <span>Azure App Service</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-lg">storage</span>
                    <span>Azure SQL Database</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-lg">folder</span>
                    <span>Storage Account</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-lg">key</span>
                    <span>Azure Key Vault</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-lg">hub</span>
                    <span>Virtual Network</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-lg">
notifications</span>
                    <span>And more...</span>
                  </div>
                </div>
              </div>
            </section>

            <!-- Template Deploy Section -->
            <section id="template-deploy" class="mb-12 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <span class="material-symbols-outlined text-3xl text-blue-600">deployed_code</span>
                Template Deploy
              </h2>
              <p class="text-gray-700 dark:text-gray-300 mb-6">
                Deploy preconfigured infrastructure templates with a single click. Templates include best-practice configurations for common application architectures and include all necessary Azure resources.
              </p>

              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-3">How to Use</h3>
              <div class="space-y-4 mb-6">
                <div class="flex gap-4">
                  <div class="flex-shrink-0 w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                    <span class="text-blue-600 dark:text-blue-400 font-bold">1</span>
                  </div>
                  <div>
                    <h4 class="font-semibold text-gray-900 dark:text-white mb-1">Browse Templates</h4>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                      Review available templates in the catalog. Each template includes a description, included resources, and configuration requirements.
                    </p>
                  </div>
                </div>
                <div class="flex gap-4">
                  <div class="flex-shrink-0 w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                    <span class="text-blue-600 dark:text-blue-400 font-bold">2</span>
                  </div>
                  <div>
                    <h4 class="font-semibold text-gray-900 dark:text-white mb-1">Select Template</h4>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                      Click "Deploy" on your chosen template. Templates are pre-configured with recommended settings but can be customized.
                    </p>
                  </div>
                </div>
                <div class="flex gap-4">
                  <div class="flex-shrink-0 w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                    <span class="text-blue-600 dark:text-blue-400 font-bold">3</span>
                  </div>
                  <div>
                    <h4 class="font-semibold text-gray-900 dark:text-white mb-1">Configure Parameters</h4>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                      Fill in required parameters like project abbreviation, service name, environment, and any template-specific settings (connection strings, domains, etc.).
                    </p>
                  </div>
                </div>
                <div class="flex gap-4">
                  <div class="flex-shrink-0 w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                    <span class="text-blue-600 dark:text-blue-400 font-bold">4</span>
                  </div>
                  <div>
                    <h4 class="font-semibold text-gray-900 dark:text-white mb-1">Deploy & Track</h4>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                      Submit the deployment. The system creates a PR with all Terraform code and provisions the entire stack automatically.
                    </p>
                  </div>
                </div>
              </div>

              <div class="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <h4 class="font-semibold text-blue-900 dark:text-blue-200 mb-2">Template Benefits</h4>
                <ul class="space-y-2 text-sm text-blue-800 dark:text-blue-300">
                  <li class="flex items-start gap-2">
                    <span class="material-symbols-outlined text-lg">speed</span>
                    <span><strong>Faster deployment:</strong> Pre-configured resources save hours of manual setup</span>
                  </li>
                  <li class="flex items-start gap-2">
                    <span class="material-symbols-outlined text-lg">verified</span>
                    <span><strong>Best practices:</strong> Templates follow Azure Well-Architected Framework guidelines</span>
                  </li>
                  <li class="flex items-start gap-2">
                    <span class="material-symbols-outlined text-lg">security</span>
                    <span><strong>Security built-in:</strong> Includes network isolation, encryption, and access controls</span>
                  </li>
                </ul>
              </div>
            </section>

            <!-- AKS Deploy Section -->
            <section id="aks-deploy" class="mb-12 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8">
              <div class="flex items-center gap-3 mb-4">
                <span class="material-symbols-outlined text-3xl text-indigo-600">package_2</span>
                <h2 class="text-2xl font-bold text-gray-900 dark:text-white">
                  AKS Playground
                </h2>
                <span class="px-3 py-1 bg-gradient-to-r from-green-100 to-teal-100 dark:from-green-900/30 dark:to-teal-900/30 text-green-800 dark:text-green-300 text-sm font-semibold rounded-full border border-green-300 dark:border-green-700">
                  ✅ devsand &amp; sand
                </span>
              </div>

              <div class="mb-6 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border-l-4 border-green-500 dark:border-green-600">
                <div class="flex items-start gap-3">
                  <span class="material-symbols-outlined text-green-600 dark:text-green-400 text-2xl">check_circle</span>
                  <div>
                    <h4 class="font-semibold text-green-900 dark:text-green-200 mb-1">Available on devsand and sand</h4>
                    <p class="text-sm text-green-800 dark:text-green-300">
                      AKS Playground is available in both <strong>devsand</strong> (default sandbox for most teams) and <strong>sand</strong> environments. Select your environment in the dropdown — only AKS-enabled environments are listed.
                    </p>
                  </div>
                </div>
              </div>

              <div class="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border-l-4 border-blue-500 dark:border-blue-600">
                <div class="flex items-start gap-3">
                  <span class="material-symbols-outlined text-blue-600 dark:text-blue-400 text-2xl">insights</span>
                  <div>
                    <h4 class="font-semibold text-blue-900 dark:text-blue-200 mb-1">Deployment Philosophy</h4>
                    <p class="text-sm text-blue-800 dark:text-blue-300">
                      <strong>Bring Your Own Container:</strong> Publish your containerized application to the <strong>EXAMPLE Container Registry</strong>, then deploy your image to AKS through this platform. We handle the Kubernetes manifests (Kustomization), deployment, and service configuration automatically.
                    </p>
                  </div>
                </div>
              </div>

              <p class="text-gray-700 dark:text-gray-300 mb-6">
                Deploy containerized applications to Azure Kubernetes Service (AKS) in the sandbox environment. Simply provide your container image details from EXAMPLE Container Registry, and the platform generates Kubernetes manifests and handles deployment automatically.
              </p>

              <p class="mb-6">
                <a
                  href="https://github.com/organization/self-service-infra/blob/main/docs/AKS-PLAYGROUND-GUIDE.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-2 text-sm font-medium text-indigo-700 dark:text-indigo-300 hover:underline"
                >
                  Read the full AKS Playground guide
                  <span class="material-symbols-outlined text-base" aria-hidden="true">open_in_new</span>
                </a>
              </p>

              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-3">How to Use</h3>
              <div class="space-y-4 mb-6">
                <div class="flex gap-4">
                  <div class="flex-shrink-0 w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center">
                    <span class="text-indigo-600 dark:text-indigo-400 font-bold">1</span>
                  </div>
                  <div>
                    <h4 class="font-semibold text-gray-900 dark:text-white mb-1">Publish to EXAMPLE Container Registry</h4>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                      Build and push your containerized application to the <strong>EXAMPLE Container Registry (ACR)</strong>. Note your image name and tag (e.g., <code class="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">exampleregistry.azurecr.io/myapp:v1.0</code>).
                    </p>
                  </div>
                </div>
                <div class="flex gap-4">
                  <div class="flex-shrink-0 w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center">
                    <span class="text-indigo-600 dark:text-indigo-400 font-bold">2</span>
                  </div>
                  <div>
                    <h4 class="font-semibold text-gray-900 dark:text-white mb-1">Specify Deployment Details &amp; Configure Variables/Secrets Yourself</h4>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                      Enter application name, namespace, container image, and deployment type (App or Agent).
                      <strong>You configure all environment variables and secrets yourself</strong> — no platform team involvement needed:
                    </p>
                    <ul class="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-400 list-disc list-inside ml-2">
                      <li><strong>Env Vars</strong> — click "Add Env Var" to inject plain key-value config into your container at runtime.</li>
                      <li><strong>Secret Env Vars</strong> — click "Add Secret Var" to source values from an existing Kubernetes Secret (specify both env var name and the secret key).</li>
                      <li><strong>Key Vault Integration</strong> — toggle on to map Azure Key Vault secrets into a Kubernetes Secret via ExternalSecret (specify KV secret name and k8s key).</li>
                    </ul>
                  </div>
                </div>

                <div class="flex gap-4">
                  <div class="flex-shrink-0 w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center">
                    <span class="text-indigo-600 dark:text-indigo-400 font-bold">3</span>
                  </div>
                  <div>
                    <h4 class="font-semibold text-gray-900 dark:text-white mb-1">Web App or Agent Configuration</h4>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                      For <strong>App</strong> deployments: set Team Label, port, and health check path — an ingress is created automatically.
                      For <strong>Agent</strong> deployments: provide Agent Name and Pool Name — no ingress is created.
                    </p>
                  </div>
                </div>

                <div class="flex gap-4">
                  <div class="flex-shrink-0 w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center">
                    <span class="text-indigo-600 dark:text-indigo-400 font-bold">4</span>
                  </div>
                  <div>
                    <h4 class="font-semibold text-gray-900 dark:text-white mb-1">Deploy &amp; Monitor</h4>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                      Submit the deployment. Kubernetes manifests are generated and applied automatically. Monitor progress via the status modal (correlationId polling).
                    </p>
                  </div>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800">
                  <h4 class="font-semibold text-indigo-900 dark:text-indigo-200 mb-2">What We Handle</h4>
                  <ul class="space-y-1 text-sm text-indigo-800 dark:text-indigo-300">
                    <li>✓ Kubernetes manifest generation (Kustomization)</li>
                    <li>✓ Deployment &amp; Service configuration</li>
                    <li>✓ Ingress setup (for web apps)</li>
                    <li>✓ ExternalSecret / Key Vault sync</li>
                    <li>✓ Resource limits &amp; health checks</li>
                  </ul>
                </div>
                <div class="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                  <h4 class="font-semibold text-green-900 dark:text-green-200 mb-2">Prerequisites</h4>
                  <ul class="space-y-1 text-sm text-green-800 dark:text-green-300">
                    <li>✓ Container image in EXAMPLE ACR</li>
                    <li>✓ Use specific image tags (not :latest)</li>
                    <li>✓ Choose deployment type (app or agent)</li>
                    <li>✓ Have namespace &amp; app name ready</li>
                    <li>✓ Know your env var names &amp; values (you set them)</li>
                    <li>✓ KV secrets must exist in Key Vault before PR merges</li>
                  </ul>
                </div>
              </div>
            </section>

            <!-- Installed Apps Section -->
            <section id="installed-apps" class="mb-12 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <span class="material-symbols-outlined text-3xl text-teal-600">apps</span>
                Installed Apps
              </h2>
              <p class="text-gray-700 dark:text-gray-300 mb-6">
                View and manage all your provisioned infrastructure and deployed applications in one centralized dashboard. Track status, view details, and perform lifecycle operations.
              </p>

              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-3">Features</h3>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div class="p-4 bg-teal-50 dark:bg-teal-900/20 rounded-lg border border-teal-200 dark:border-teal-800">
                  <h4 class="font-semibold text-teal-900 dark:text-teal-200 mb-2 flex items-center gap-2">
                    <span class="material-symbols-outlined">visibility</span>
                    View Applications
                  </h4>
                  <p class="text-sm text-teal-800 dark:text-teal-300">
                    See all deployed applications with details like project abbreviation, service name, environment, modules, owner, and creation date.
                  </p>
                </div>
                <div class="p-4 bg-teal-50 dark:bg-teal-900/20 rounded-lg border border-teal-200 dark:border-teal-800">
                  <h4 class="font-semibold text-teal-900 dark:text-teal-200 mb-2 flex items-center gap-2">
                    <span class="material-symbols-outlined">filter_alt</span>
                    Filter & Search
                  </h4>
                  <p class="text-sm text-teal-800 dark:text-teal-300">
                    Filter by environment, project abbreviation, or owner. Search across all metadata to quickly find specific applications.
                  </p>
                </div>
                <div class="p-4 bg-teal-50 dark:bg-teal-900/20 rounded-lg border border-teal-200 dark:border-teal-800">
                  <h4 class="font-semibold text-teal-900 dark:text-teal-200 mb-2 flex items-center gap-2">
                    <span class="material-symbols-outlined">link</span>
                    Azure Portal Links
                  </h4>
                  <p class="text-sm text-teal-800 dark:text-teal-300">
                    Direct links to view resources in Azure Portal. Quickly access resource groups and individual resources.
                  </p>
                </div>
                <div class="p-4 bg-teal-50 dark:bg-teal-900/20 rounded-lg border border-teal-200 dark:border-teal-800">
                  <h4 class="font-semibold text-teal-900 dark:text-teal-200 mb-2 flex items-center gap-2">
                    <span class="material-symbols-outlined">delete</span>
                    Lifecycle Management
                  </h4>
                  <p class="text-sm text-teal-800 dark:text-teal-300">
                    Delete applications when no longer needed. Triggers automated Terraform destroy workflow with proper cleanup.
                  </p>
                </div>
              </div>

              <div class="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
                <h4 class="font-semibold text-gray-900 dark:text-white mb-2">Application Status Indicators</h4>
                <div class="space-y-2 text-sm">
                  <div class="flex items-center gap-3">
                    <span class="w-3 h-3 bg-green-500 rounded-full"></span>
                    <span class="text-gray-700 dark:text-gray-300"><strong>Active:</strong> Successfully provisioned and running</span>
                  </div>
                  <div class="flex items-center gap-3">
                    <span class="w-3 h-3 bg-yellow-500 rounded-full"></span>
                    <span class="text-gray-700 dark:text-gray-300"><strong>Provisioning:</strong> Currently being deployed</span>
                  </div>
                  <div class="flex items-center gap-3">
                    <span class="w-3 h-3 bg-red-500 rounded-full"></span>
                    <span class="text-gray-700 dark:text-gray-300"><strong>Failed:</strong> Deployment encountered an error</span>
                  </div>
                  <div class="flex items-center gap-3">
                    <span class="w-3 h-3 bg-gray-500 rounded-full"></span>
                    <span class="text-gray-700 dark:text-gray-300"><strong>Deleted:</strong> Marked for deletion or already removed</span>
                  </div>
                </div>
              </div>
            </section>

            <!-- Ship from Repo Section (shown only while an environment has the shipFromRepo flag) -->
            <section v-if="environmentsStore.shipEnabled" id="ship-from-repo" data-testid="docs-ship-section" class="mb-12 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8">
              <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <span class="material-symbols-outlined text-3xl text-purple-600">rocket_launch</span>
                Ship from Repo
              </h2>
              <p class="text-gray-700 dark:text-gray-300 mb-6">
                Ship an app straight from a GitHub repository: choose the repository and branch, give the app a name, and click Ship. The platform builds it, runs a security check, publishes it and opens a pull request with a preview, so you don't need a Dockerfile or a CI pipeline.
              </p>

              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-3">How it works</h3>
              <ol class="list-decimal ml-6 mb-6 space-y-1 text-gray-700 dark:text-gray-300">
                <li>Pick a repository you can read and a branch (the default branch is pre-selected).</li>
                <li>Click <strong>Ship</strong>. Progress shows Build, Security check, Publish, Review PR and Preview.</li>
                <li>When it finishes you get a version number, the pull request link ("Request production deploy via this PR") and the preview link.</li>
                <li>Pushed more code? Open the ship and click <strong>Ship new version</strong>. Pushing to the branch never deploys by itself, and no change to your repository is required.</li>
              </ol>

              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-3">Supported languages</h3>
              <p class="text-gray-700 dark:text-gray-300 mb-2">
                Node.js, Python, Java, Go, .NET, Ruby and PHP (the platform team maintains the list; the page shows it if a build isn't supported). The project root needs the usual manifest for its language, for example <code>package.json</code>, <code>requirements.txt</code>, <code>pom.xml</code>, <code>go.mod</code> or a <code>.csproj</code> file.
              </p>
              <p class="text-gray-700 dark:text-gray-300 mb-6">
                A Dockerfile in your repository is ignored. Private package feeds, build-time secrets, Git submodules and Git LFS are not supported.
              </p>

              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-3">Port and health path</h3>
              <p class="text-gray-700 dark:text-gray-300 mb-6">
                Your app must listen on the port given by the <code>$PORT</code> environment variable (8080 by default, changeable under Advanced settings, 1024-65535). The health path defaults to <code>/healthz</code>; many apps use <code>/health</code>. After the pull request is merged these settings are fixed; ask the platform team to change them.
              </p>

              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-3">Limits</h3>
              <ul class="list-disc ml-6 mb-6 space-y-1 text-gray-700 dark:text-gray-300">
                <li>Each person can have a few ships running at once and start a limited number per hour; the page tells you if you hit a limit.</li>
                <li>A build can take at most 30 minutes.</li>
                <li>You can cancel a ship until publishing has started.</li>
                <li>Only people who can read the repository (and the platform GitHub App must be installed on it) can ship it.</li>
              </ul>

              <button
                type="button"
                class="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition-colors"
                @click="navigationStore.navigateToPage('ship')"
              >
                Open Ship from Repo
              </button>
            </section>

            <!-- Existing Infra Section -->
            <section id="existing-infra" class="mb-12 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8">
              <div class="flex items-center gap-3 mb-4">
                <span class="material-symbols-outlined text-3xl text-purple-600">inventory_2</span>
                <h2 class="text-2xl font-bold text-gray-900 dark:text-white">
                  Existing Infrastructure Change
                </h2>
                <span class="px-3 py-1 bg-gradient-to-r from-purple-100 to-indigo-100 dark:from-purple-900/30 dark:to-indigo-900/30 text-purple-800 dark:text-purple-300 text-sm font-semibold rounded-full border border-purple-300 dark:border-purple-700">
                  ✅ Live
                </span>
              </div>

              <div class="mb-6 p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border-l-4 border-purple-500 dark:border-purple-600">
                <div class="flex items-start gap-3">
                  <span class="material-symbols-outlined text-purple-600 dark:text-purple-400 text-2xl">smart_toy</span>
                  <div>
                    <h4 class="font-semibold text-purple-900 dark:text-purple-200 mb-1">Backed by Agentic Teams</h4>
                    <p class="text-sm text-purple-800 dark:text-purple-300">
                      Each change request is dispatched to a specialized AI agent that generates and applies the Terraform changes. Your request triggers a real GitHub Actions workflow — no manual platform team involvement for standard change types.
                    </p>
                  </div>
                </div>
              </div>

              <p class="text-gray-700 dark:text-gray-300 mb-6">
                Use the three-step wizard to request modifications to your existing Azure infrastructure using specialized AI agents. Submit the request and the platform dispatches a GitHub Actions workflow that generates and applies Terraform changes via Pull Request.
              </p>

              <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-3">Three-Step Wizard</h3>
              <div class="space-y-4 mb-6">
                <div class="flex gap-4">
                  <div class="flex-shrink-0 w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
                    <span class="text-purple-600 dark:text-purple-400 font-bold">1</span>
                  </div>
                  <div>
                    <h4 class="font-semibold text-gray-900 dark:text-white mb-1">Select Agent</h4>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                      Choose the agent type that matches your change request from the catalog (populated from <code class="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">data/agents.json</code>). Each agent handles a specific service type — e.g., Event Grid, Service Bus, Storage, WAF.
                    </p>
                  </div>
                </div>
                <div class="flex gap-4">
                  <div class="flex-shrink-0 w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
                    <span class="text-purple-600 dark:text-purple-400 font-bold">2</span>
                  </div>
                  <div>
                    <h4 class="font-semibold text-gray-900 dark:text-white mb-1">Fill Inputs</h4>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                      Complete the agent-specific form fields. All fields are validated before you can proceed. Your authenticated email is pre-populated as <em>Triggered By</em> — no manual entry needed.
                    </p>
                  </div>
                </div>
                <div class="flex gap-4">
                  <div class="flex-shrink-0 w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
                    <span class="text-purple-600 dark:text-purple-400 font-bold">3</span>
                  </div>
                  <div>
                    <h4 class="font-semibold text-gray-900 dark:text-white mb-1">Review &amp; Submit</h4>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                      Confirm all details on the review screen. Submitting opens a PR in <code class="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">service-catalog</code> and triggers the agent workflow. Track progress via the status modal (correlationId polling). You can go back to any completed step to make changes.
                    </p>
                  </div>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                  <h4 class="font-semibold text-purple-900 dark:text-purple-200 mb-3 flex items-center gap-2">
                    <span class="material-symbols-outlined">build_circle</span>
                    Supported Change Types
                  </h4>
                  <div class="space-y-2 text-sm text-purple-800 dark:text-purple-300">
                    <div class="flex items-start gap-2">
                      <span class="material-symbols-outlined text-lg">router</span>
                      <span><strong>Event Grid</strong> — topics, subscriptions, event routing</span>
                    </div>
                    <div class="flex items-start gap-2">
                      <span class="material-symbols-outlined text-lg">hub</span>
                      <span><strong>Service Bus</strong> — topics and subscriptions</span>
                    </div>
                    <div class="flex items-start gap-2">
                      <span class="material-symbols-outlined text-lg">storage</span>
                      <span><strong>Storage</strong> — accounts and containers</span>
                    </div>
                    <div class="flex items-start gap-2">
                      <span class="material-symbols-outlined text-lg">shield</span>
                      <span><strong>WAF</strong> — policies and rules</span>
                    </div>
                  </div>
                </div>
                <div class="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <h4 class="font-semibold text-blue-900 dark:text-blue-200 mb-3 flex items-center gap-2">
                    <span class="material-symbols-outlined">info</span>
                    What to Expect
                  </h4>
                  <ul class="space-y-2 text-sm text-blue-800 dark:text-blue-300">
                    <li>✓ PR opened in service-catalog repo</li>
                    <li>✓ Agent workflow triggered automatically</li>
                    <li>✓ Real-time status via correlationId modal</li>
                    <li>✓ Triggered By pre-filled from your Entra ID email</li>
                    <li>✓ Navigate back to previous steps at any time</li>
                  </ul>
                </div>
              </div>
            </section>

            <!-- Support Section -->
            <section class="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg border border-blue-200 dark:border-blue-800 p-8">\n              <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">\n                <span class="material-symbols-outlined text-3xl text-blue-600">support_agent</span>
                Need Help?
              </h2>
              <p class="text-gray-700 dark:text-gray-300 mb-6">
                If you encounter issues or have questions, here are some resources:
              </p>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <a
                  href="https://learn.microsoft.com/azure/architecture/"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="p-4 bg-white dark:bg-gray-800 rounded-lg border border-blue-200 dark:border-blue-800 hover:shadow-lg transition-shadow"
                >
                  <div class="flex items-center gap-3 mb-2">
                    <span class="material-symbols-outlined text-2xl text-blue-600">smart_toy</span>
                    <h3 class="font-semibold text-gray-900 dark:text-white">Azure Architecture Center</h3>
                  </div>
                  <p class="text-sm text-gray-600 dark:text-gray-400">
                    Reference architectures and Azure design guidance
                  </p>
                </a>
                <div class="p-4 bg-white dark:bg-gray-800 rounded-lg border border-blue-200 dark:border-blue-800">
                  <div class="flex items-center gap-3 mb-2">
                    <span class="material-symbols-outlined text-2xl text-blue-600">feedback</span>
                    <h3 class="font-semibold text-gray-900 dark:text-white">Request Feature / Bugfix</h3>
                  </div>
                  <p class="text-sm text-gray-600 dark:text-gray-400">
                    Use the in-product feedback form (top-right nav) to raise a Bug Report, Feature Request, or Agent Request — backed by agentic teams.
                  </p>
                </div>
                <div class="p-4 bg-white dark:bg-gray-800 rounded-lg border border-blue-200 dark:border-blue-800">
                  <div class="flex items-center gap-3 mb-2">
                    <span class="material-symbols-outlined text-2xl text-blue-600">mail</span>
                    <h3 class="font-semibold text-gray-900 dark:text-white">DevOps Team</h3>
                  </div>
                  <p class="text-sm text-gray-600 dark:text-gray-400">
                    Contact the DevOps team for infrastructure support
                  </p>
                </div>
              </div>
            </section>

            <!-- Feedback / Request Feature Section -->
            <section id="feedback" class="mb-12 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8">
              <div class="flex items-center gap-3 mb-4">
                <span class="material-symbols-outlined text-3xl text-rose-600">feedback</span>
                <h2 class="text-2xl font-bold text-gray-900 dark:text-white">
                  Request Feature / Bugfix
                </h2>
              </div>

              <div class="mb-6 p-4 bg-rose-50 dark:bg-rose-900/20 rounded-lg border-l-4 border-rose-500 dark:border-rose-600">
                <div class="flex items-start gap-3">
                  <span class="material-symbols-outlined text-rose-600 dark:text-rose-400 text-2xl">group</span>
                  <div>
                    <h4 class="font-semibold text-rose-900 dark:text-rose-200 mb-1">Backed by Agentic Teams</h4>
                    <p class="text-sm text-rose-800 dark:text-rose-300">
                      <strong>Agent Requests</strong> are picked up by the platform's agentic orchestration workflow for triage, scoping, and delivery. Bug reports and feature requests are automatically labeled and triaged by the platform team.
                    </p>
                  </div>
                </div>
              </div>

              <p class="text-gray-700 dark:text-gray-300 mb-6">
                Click <strong>"Request Feature/Bugfix"</strong> in the top-right navigation to open the feedback form. Your Entra ID email is pre-filled automatically. On submission a GitHub issue is created in <code class="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">organization/self-service-infra</code> and you receive a direct link to track it.
              </p>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                  <h4 class="font-semibold text-red-900 dark:text-red-200 mb-2 flex items-center gap-2">
                    <span class="material-symbols-outlined text-lg">bug_report</span>
                    Bug Report
                  </h4>
                  <ul class="space-y-1 text-xs text-red-800 dark:text-red-300">
                    <li>Title (required)</li>
                    <li>Observed vs Expected Behaviour</li>
                    <li>Steps to Reproduce</li>
                    <li>Severity: Critical / High / Medium / Low</li>
                  </ul>
                </div>
                <div class="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                  <h4 class="font-semibold text-amber-900 dark:text-amber-200 mb-2 flex items-center gap-2">
                    <span class="material-symbols-outlined text-lg">lightbulb</span>
                    Feature Request
                  </h4>
                  <ul class="space-y-1 text-xs text-amber-800 dark:text-amber-300">
                    <li>Title (required)</li>
                    <li>Pain Point / Problem Statement</li>
                    <li>Desired Outcome</li>
                    <li>Priority: High / Medium / Low</li>
                  </ul>
                </div>
                <div class="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                  <h4 class="font-semibold text-purple-900 dark:text-purple-200 mb-2 flex items-center gap-2">
                    <span class="material-symbols-outlined text-lg">smart_toy</span>
                    Agent Request
                  </h4>
                  <ul class="space-y-1 text-xs text-purple-800 dark:text-purple-300">
                    <li>Title (required)</li>
                    <li>Existing Infrastructure / Agent Type</li>
                    <li>Desired Agent Behaviour</li>
                    <li>Business Justification</li>
                  </ul>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Smooth scrolling for anchor links */
html {
  scroll-behavior: smooth;
}

/* Ensure proper spacing for sticky sidebar */
.sticky {
  position: sticky;
  top: 1rem;
}
</style>
