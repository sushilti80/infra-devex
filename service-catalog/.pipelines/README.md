## Pipeline Usage

 The infra-pipeline.yaml is a single pipeline template using multistage deployments for all infrastructure.

 You may also reference the ``env`` directory for environment specific templates for single deployments cases.

- ``Build stage``
  This stage runs terragrunt plan to generate plan artifacts, trivy scan and Infra cost to generate prediction.

- ``Deploy stage``
  This stage applies the code using environments and approval gates to ensure previous stage has been verified and approved.

## Pipeline Modification
   1- copy the pipeline template to any deployment directory

   2- remove or uncomment the stages that arent required for your deployment.

   3- Add working directory path into yaml file.

            parameters:
            - name: directorypath
                type: string
                default: infrastructure/ # DIRECTORY PATH HERE

If the application will be deployed from DevSand through PROD, using this template you can stage and build each environment as you go
