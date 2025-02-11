import {BaseSchemaWithHandle} from '../schemas.js'
import {createExtensionSpecification} from '../specification.js'
import {
  validateFieldShape,
  startsWithHttps,
  validateCustomConfigurationPageConfig,
  validateReturnTypeConfig,
} from '../../../services/flow/validation.js'
import {serializeFields} from '../../../services/flow/serialize-fields.js'
import {joinPath} from '@shopify/cli-kit/node/path'
import {glob, readFile} from '@shopify/cli-kit/node/fs'
import {zod} from '@shopify/cli-kit/node/schema'

export const FlowActionExtensionSchema = BaseSchemaWithHandle.extend({
  type: zod.literal('flow_action'),
  runtime_url: zod.string().url().refine(startsWithHttps),
  validation_url: zod.string().url().refine(startsWithHttps).optional(),
  config_page_url: zod.string().url().refine(startsWithHttps).optional(),
  config_page_preview_url: zod.string().url().refine(startsWithHttps).optional(),
  schema: zod.string().optional(),
  return_type_ref: zod.string().optional(),
}).refine((config) => {
  const configurationPageIsValid = validateCustomConfigurationPageConfig(
    config.config_page_url,
    config.config_page_preview_url,
    config.validation_url,
  )
  const fields = config.settings?.fields ?? []
  const settingsFieldsAreValid = fields.every((field, index) =>
    validateFieldShape(field, 'flow_action', config.handle, index),
  )
  const returnTypeIsValid = validateReturnTypeConfig(config.return_type_ref, config.schema)

  return configurationPageIsValid && settingsFieldsAreValid && returnTypeIsValid
})

/**
 * Loads the schema from the partner defined file.
 */
const loadSchemaPatchFromPath = async (extensionPath: string, patchPath: string | undefined) => {
  if (!patchPath) {
    return ''
  }

  const path = await glob(joinPath(extensionPath, patchPath))

  if (path.length > 1) {
    throw new Error('Multiple files found for schema patch path')
  } else if (path.length === 0) {
    throw new Error('No file found for schema patch path')
  }

  return readFile(path[0] as string)
}

/**
 * Extension specification with all properties and methods needed to load a Flow Action.
 */
const flowActionSpecification = createExtensionSpecification({
  identifier: 'flow_action',
  schema: FlowActionExtensionSchema,
  // Flow doesn't have anything to bundle but we need to set this to true to
  // ensure that the extension configuration is uploaded after registration in
  // https://github.com/Shopify/cli/blob/73ac91c0f40be0a57d1b18cb34254b12d3a071af/packages/app/src/cli/services/deploy.ts#L107
  // Should be removed after unified deployment is 100% rolled out
  appModuleFeatures: (_) => ['bundling'],
  deployConfig: async (config, extensionPath) => {
    return {
      title: config.name,
      handle: config.handle,
      description: config.description,
      url: config.runtime_url,
      fields: serializeFields('flow_action', config.settings?.fields),
      validation_url: config.validation_url,
      custom_configuration_page_url: config.config_page_url,
      custom_configuration_page_preview_url: config.config_page_preview_url,
      schema_patch: await loadSchemaPatchFromPath(extensionPath, config.schema),
      return_type_ref: config.return_type_ref,
    }
  },
})

export default flowActionSpecification
