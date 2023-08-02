import {BaseSchemaWithHandle} from '../schemas.js'
import {createExtensionSpecification} from '../specification.js'
import {loadLocalesConfig} from '../../../utilities/extensions/locales-configuration.js'
import {joinPath} from '@shopify/cli-kit/node/path'
import {zod} from '@shopify/cli-kit/node/schema'
import {AbortError} from '@shopify/cli-kit/node/error'
import {glob} from '@shopify/cli-kit/node/fs'
import fs from 'fs'

const FlowTemplateExtensionSchema = BaseSchemaWithHandle.extend({
  type: zod.literal('flow_template'),
  name: zod.string(),
  templates: zod
    .array(
      zod.object({
        key: zod.string(),
        name: zod.string(),
        description: zod.string(),
        categories: zod.array(zod.string()),
        require_app: zod.boolean(),
        listed: zod.boolean(),
        enabled: zod.boolean(),
      }),
    )
    // technically we'll be able to support more than one template per extension but restricting to one for now
    .min(1)
    .max(1),
})

const spec = createExtensionSpecification({
  identifier: 'flow_template',
  schema: FlowTemplateExtensionSchema,
  singleEntryPath: false,
  appModuleFeatures: (_) => ['bundling'],
  deployConfig: async (config, extensionPath) => {
    return {
      templates: await Promise.all(
        config.templates.map(async (template) => {
          return {
            key: template.key,
            name: template.name,
            description: template.description,
            categories: template.categories,
            require_app: template.require_app,
            listed: template.listed,
            enabled: template.enabled,
            definition: await loadWorkflow(extensionPath, template.key),
            localization: await loadLocalesConfig(joinPath(extensionPath, template.key), template.key),
          }
        }),
      ),
    }
  },
})

async function loadWorkflow(path: string, key: string) {
  const flowFilePaths = await glob(joinPath(path, key, `${key}.flow`))
  const flowFilePath = flowFilePaths[0]
  if (!flowFilePath) {
    throw new AbortError(`Missing ${key}.flow file in ${joinPath(path, key)}`)
  }
  return fs.readFileSync(flowFilePath, 'base64')
}

export default spec
