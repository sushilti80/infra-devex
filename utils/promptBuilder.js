const logger = require('./logger');

/**
 * Build a structured prompt for the agent dispatch workflow
 * Combines agent description with structured parameter data
 * 
 * @param {Object} params - The parameters for building the prompt
 * @param {Object} params.agent - Agent definition from agents.json
 * @param {Object} params.formData - User-provided input values (key-value pairs)
 * @param {string} params.correlationId - Correlation ID for tracking
 * @returns {string} - Formatted prompt string
 */
function buildAgentPrompt({ agent, formData, correlationId }) {
  try {
    logger.info(`[${correlationId}] Building prompt for agent: ${agent.agentName}`);

    // Start with agent context
    let prompt = `Agent: ${agent.agentName}\n`;
    prompt += `Description: ${agent.description}\n\n`;

    // Separate required and optional inputs
    const requiredInputs = agent.inputs.filter(input => input.required);
    const optionalInputs = agent.inputs.filter(input => !input.required);

    // Add required parameters section
    if (requiredInputs.length > 0) {
      prompt += `Required Parameters:\n`;
      requiredInputs.forEach(input => {
        const value = formData[input.name] || '';
        prompt += `- ${input.name}: ${value}\n`;
        prompt += `  Description: ${input.description}\n`;
      });
      prompt += `\n`;
    }

    // Add optional parameters section (only if provided)
    const providedOptionalInputs = optionalInputs.filter(input => {
      const value = formData[input.name];
      return value && value.trim() !== '';
    });

    if (providedOptionalInputs.length > 0) {
      prompt += `Optional Parameters:\n`;
      providedOptionalInputs.forEach(input => {
        const value = formData[input.name];
        prompt += `- ${input.name}: ${value}\n`;
        prompt += `  Description: ${input.description}\n`;
      });
      prompt += `\n`;
    }

    // Add instruction for the agent
    prompt += `analyze the existing infrastructure and apply the necessary changes to support these requirements.\n`;

    logger.info(`[${correlationId}] Prompt built successfully, length: ${prompt.length} characters`);

    return prompt;

  } catch (error) {
    logger.error(`[${correlationId}] Error building prompt: ${error.message}`, { error });
    throw new Error(`Failed to build agent prompt: ${error.message}`);
  }
}

/**
 * Validate that all required inputs are provided
 * 
 * @param {Object} agent - Agent definition from agents.json
 * @param {Object} formData - User-provided input values
 * @returns {Object} - { valid: boolean, missingFields: string[] }
 */
function validateRequiredInputs(agent, formData) {
  const requiredInputs = agent.inputs.filter(input => input.required);
  const missingFields = [];

  requiredInputs.forEach(input => {
    const value = formData[input.name];
    if (!value || value.trim() === '') {
      missingFields.push(input.name);
    }
  });

  return {
    valid: missingFields.length === 0,
    missingFields
  };
}

module.exports = {
  buildAgentPrompt,
  validateRequiredInputs
};
