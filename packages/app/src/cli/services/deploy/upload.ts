import {themeExtensionConfig as generateThemeExtensionConfig} from './theme-extension-config.js'
import {DeploymentMode} from './mode.js'
import {Identifiers, IdentifiersExtensions} from '../../models/app/identifiers.js'
import {
  UploadUrlGenerateMutation,
  UploadUrlGenerateMutationSchema,
} from '../../api/graphql/functions/upload_url_generate.js'
import {
  ExtensionUpdateDraftInput,
  ExtensionUpdateDraftMutation,
  ExtensionUpdateSchema,
} from '../../api/graphql/update_draft.js'
import {AppDeploy, AppDeploySchema, AppDeployVariables, AppModuleSettings} from '../../api/graphql/app_deploy.js'
import {
  GenerateSignedUploadUrl,
  GenerateSignedUploadUrlSchema,
  GenerateSignedUploadUrlVariables,
} from '../../api/graphql/generate_signed_upload_url.js'
import {
  AppFunctionSetMutation,
  AppFunctionSetMutationSchema,
  AppFunctionSetVariables,
} from '../../api/graphql/functions/app_function_set.js'
import {ExtensionInstance} from '../../models/extensions/extension-instance.js'
import {FunctionConfigType} from '../../models/extensions/specifications/function.js'
import {functionProxyRequest, partnersRequest} from '@shopify/cli-kit/node/api/partners'
import {randomUUID} from '@shopify/cli-kit/node/crypto'
import {ensureAuthenticatedPartners} from '@shopify/cli-kit/node/session'
import {fileExists, readFile, readFileSync} from '@shopify/cli-kit/node/fs'
import {fetch, formData} from '@shopify/cli-kit/node/http'
import {AbortError, BugError} from '@shopify/cli-kit/node/error'
import {formatPackageManagerCommand, outputContent, outputToken} from '@shopify/cli-kit/node/output'
import {AlertCustomSection, ListToken, TokenItem} from '@shopify/cli-kit/node/ui'
import {partition} from '@shopify/cli-kit/common/collection'
import {getPackageManager} from '@shopify/cli-kit/node/node-package-manager'
import {cwd} from '@shopify/cli-kit/node/path'

interface DeployThemeExtensionOptions {
  /** The application API key */
  apiKey: string

  /** Set of local identifiers */
  identifiers: Identifiers

  /** The token to send authenticated requests to the partners' API  */
  token: string
}

/**
 * Uploads theme extension(s)
 * @param options - The upload options
 */
export async function uploadThemeExtensions(
  themeExtensions: ExtensionInstance[],
  options: DeployThemeExtensionOptions,
): Promise<void> {
  const {apiKey, identifiers, token} = options
  await Promise.all(
    themeExtensions.map(async (themeExtension) => {
      const themeExtensionConfig = await generateThemeExtensionConfig(themeExtension)
      const themeId = identifiers.extensionIds[themeExtension.localIdentifier]!
      const themeExtensionInput: ExtensionUpdateDraftInput = {
        apiKey,
        config: JSON.stringify(themeExtensionConfig),
        context: undefined,
        registrationId: themeId,
      }
      const mutation = ExtensionUpdateDraftMutation
      const result: ExtensionUpdateSchema = await partnersRequest(mutation, token, themeExtensionInput)
      if (result.extensionUpdateDraft?.userErrors?.length > 0) {
        const errors = result.extensionUpdateDraft.userErrors.map((error) => error.message).join(', ')
        throw new AbortError(errors)
      }
    }),
  )
}

interface UploadExtensionsBundleOptions {
  /** The application API key */
  apiKey: string

  /** The path to the bundle file to be uploaded */
  bundlePath?: string

  /** The token to send authenticated requests to the partners' API  */
  token: string

  /** App Modules extra data */
  appModules: AppModuleSettings[]

  /** The extensions' numeric identifiers (expressed as a string). */
  extensionIds: IdentifiersExtensions

  /** The mode of the deployment */
  deploymentMode: DeploymentMode

  /** App version message */
  message?: string

  /** App version identifier */
  version?: string

  /** The git reference url of the app version */
  commitReference?: string
}

export interface UploadExtensionValidationError {
  uuid: string
  errors: {
    message: string
    field: string[]
  }[]
}

export interface UploadExtensionsBundleOutput {
  validationErrors: UploadExtensionValidationError[]
  versionTag: string
  message?: string
  location: string
  deployError?: string
}

type ErrorSectionBody = TokenItem
interface ErrorCustomSection extends AlertCustomSection {
  body: ErrorSectionBody
}

/**
 * Uploads a bundle.
 * @param options - The upload options
 */
export async function uploadExtensionsBundle(
  options: UploadExtensionsBundleOptions,
): Promise<UploadExtensionsBundleOutput> {
  const appVersionUUID = randomUUID()
  let signedURL
  let deployError

  if (options.bundlePath) {
    signedURL = await getExtensionUploadURL(options.apiKey, appVersionUUID)

    const form = formData()
    const buffer = readFileSync(options.bundlePath)
    form.append('my_upload', buffer)
    await fetch(signedURL, {
      method: 'put',
      body: buffer,
      headers: form.getHeaders(),
    })
  }

  const variables: AppDeployVariables = {
    apiKey: options.apiKey,
    uuid: appVersionUUID,
    skipPublish: !(options.deploymentMode === 'unified'),
    message: options.message,
    versionTag: options.version,
    commitReference: options.commitReference,
  }

  if (signedURL) {
    variables.bundleUrl = signedURL
  }

  if (options.appModules.length > 0) {
    variables.appModules = options.appModules
  }

  const mutation = AppDeploy
  const result: AppDeploySchema = await handlePartnersErrors(() => partnersRequest(mutation, options.token, variables))

  if (result.appDeploy?.userErrors?.length > 0) {
    const customSections: AlertCustomSection[] = deploymentErrorsToCustomSections(
      result.appDeploy.userErrors,
      options.extensionIds,
      {
        version: options.version,
      },
    )

    if (result.appDeploy.appVersion) {
      deployError = result.appDeploy.userErrors.map((error) => error.message).join(', ')
    } else {
      throw new AbortError({bold: "Version couldn't be created."}, null, [], customSections)
    }
  }

  const validationErrors = result.appDeploy.appVersion.appModuleVersions
    .filter((ver) => ver.validationErrors.length > 0)
    .map((ver) => {
      return {uuid: ver.registrationUuid, errors: ver.validationErrors}
    })

  return {
    validationErrors,
    versionTag: result.appDeploy.appVersion.versionTag,
    location: result.appDeploy.appVersion.location,
    message: result.appDeploy.appVersion.message,
    deployError,
  }
}

const VALIDATION_ERRORS_TITLE = '\nValidation errors'
const GENERIC_ERRORS_TITLE = '\n'

export function deploymentErrorsToCustomSections(
  errors: AppDeploySchema['appDeploy']['userErrors'],
  extensionIds: IdentifiersExtensions,
  flags: {
    version?: string
  } = {},
): ErrorCustomSection[] {
  const isExtensionError = (error: (typeof errors)[0]) => {
    return error.details?.some((detail) => detail.extension_id) ?? false
  }

  const isCliError = (error: (typeof errors)[0], extensionIds: IdentifiersExtensions) => {
    const errorExtensionId =
      error.details?.find((detail) => typeof detail.extension_id !== 'undefined')?.extension_id.toString() ?? ''

    return Object.values(extensionIds).includes(errorExtensionId)
  }

  const [extensionErrors, nonExtensionErrors] = partition(errors, (error) => isExtensionError(error))

  const [cliErrors, partnersErrors] = partition(extensionErrors, (error) => isCliError(error, extensionIds))

  const customSections = [
    ...generalErrorsSection(nonExtensionErrors, {version: flags.version}),
    ...cliErrorsSections(cliErrors, extensionIds),
    ...partnersErrorsSections(partnersErrors),
  ]
  return customSections
}

function generalErrorsSection(errors: AppDeploySchema['appDeploy']['userErrors'], flags: {version?: string} = {}) {
  if (errors.length > 0) {
    if (
      errors.filter((error) => error.field.includes('version_tag') && error.message === 'has already been taken')
        .length > 0 &&
      flags.version
    ) {
      return [
        {
          body: [
            'An app version with the name',
            {userInput: flags.version},
            'already exists. Deploy again with a different version name.',
          ],
        },
      ]
    }

    if (errors.length === 1) {
      return [
        {
          body: errors[0]!.message,
        },
      ]
    }

    return [
      {
        body: {
          list: {
            items: errors.map((error) => error.message),
          },
        },
      },
    ]
  } else {
    return []
  }
}

function cliErrorsSections(errors: AppDeploySchema['appDeploy']['userErrors'], identifiers: IdentifiersExtensions) {
  return errors.reduce((sections, error) => {
    const field = error.field.join('.').replace('extension_points', 'extensions.targeting')
    const errorMessage = field === 'base' ? error.message : `${field}: ${error.message}`

    const remoteTitle = error.details.find((detail) => typeof detail.extension_title !== 'undefined')?.extension_title
    const extensionIdentifier = error.details
      .find((detail) => typeof detail.extension_id !== 'undefined')
      ?.extension_id.toString()

    const handle = Object.keys(identifiers).find((key) => identifiers[key] === extensionIdentifier)
    const extensionName = handle ?? remoteTitle

    const existingSection = sections.find((section) => section.title === extensionName)

    if (existingSection) {
      const sectionBody = existingSection.body as ListToken[]
      const errorsList =
        error.category === 'invalid'
          ? sectionBody.find((listToken) => listToken.list.title === VALIDATION_ERRORS_TITLE)
          : sectionBody.find((listToken) => listToken.list.title === GENERIC_ERRORS_TITLE)

      if (errorsList) {
        errorsList.list.items.push(errorMessage)
      } else {
        sectionBody.push({
          list: {
            title: error.category === 'invalid' ? VALIDATION_ERRORS_TITLE : GENERIC_ERRORS_TITLE,
            items: [errorMessage],
          },
        })
      }
    } else {
      sections.push({
        title: extensionName,
        body: [
          {
            list: {
              title: error.category === 'invalid' ? VALIDATION_ERRORS_TITLE : GENERIC_ERRORS_TITLE,
              items: [errorMessage],
            },
          },
        ],
      })
    }

    sections.forEach((section) => {
      // eslint-disable-next-line id-length
      ;(section.body as ListToken[]).sort((a, b) => {
        if (a.list.title === VALIDATION_ERRORS_TITLE) {
          return 1
        }

        if (b.list.title === VALIDATION_ERRORS_TITLE) {
          return -1
        }

        return 0
      })
    })

    return sections
  }, [] as ErrorCustomSection[])
}

function partnersErrorsSections(errors: AppDeploySchema['appDeploy']['userErrors']) {
  return errors
    .reduce((sections, error) => {
      const extensionIdentifier = error.details.find(
        (detail) => typeof detail.extension_title !== 'undefined',
      )?.extension_title

      const existingSection = sections.find((section) => section.title === extensionIdentifier)

      if (existingSection) {
        existingSection.errorCount += 1
      } else {
        sections.push({
          title: extensionIdentifier,
          errorCount: 1,
        })
      }

      return sections
    }, [] as {title: string | undefined; errorCount: number}[])
    .map((section) => ({
      title: section.title,
      body: `\n${section.errorCount} error${
        section.errorCount > 1 ? 's' : ''
      } found in your extension. Fix these issues in the Partner Dashboard and try deploying again.`,
    })) as ErrorCustomSection[]
}

/**
 * It generates a URL to upload an app bundle.
 * @param apiKey - The application API key
 * @param appVersionUUID - The unique identifier of the app version.
 */
export async function getExtensionUploadURL(apiKey: string, appVersionUUID: string) {
  const mutation = GenerateSignedUploadUrl
  const token = await ensureAuthenticatedPartners()
  const variables: GenerateSignedUploadUrlVariables = {
    apiKey,
    appVersionUuid: appVersionUUID,
    bundleFormat: 1,
  }

  const result: GenerateSignedUploadUrlSchema = await handlePartnersErrors(() =>
    partnersRequest(mutation, token, variables),
  )

  if (result.deploymentGenerateSignedUploadUrl?.userErrors?.length > 0) {
    const errors = result.deploymentGenerateSignedUploadUrl.userErrors.map((error) => error.message).join(', ')
    throw new AbortError(errors)
  }

  return result.deploymentGenerateSignedUploadUrl.signedUploadUrl
}

interface UploadFunctionExtensionsOptions {
  /** The token to send authenticated requests to the partners' API  */
  token: string

  // Set of local identifiers
  identifiers: Identifiers
}

/**
 * This function takes a list of function extensions and uploads them.
 * As part of the upload it creates a function server-side if it does not exist
 * and includes its remote identifier in the returned identifiers instance.
 * If the function already has a local id, that one is used and the upload
 * does an override of the function existing server-side.
 *
 * @param extensions - The list of extensions to upload.
 * @param options - Options to adjust the upload.
 * @returns A promise that resolves with the identifiers.
 */
export async function uploadFunctionExtensions(
  extensions: ExtensionInstance<FunctionConfigType>[],
  options: UploadFunctionExtensionsOptions,
): Promise<Identifiers> {
  let identifiers = options.identifiers

  const functionIds: IdentifiersExtensions = {}

  // Functions are uploaded sequentially to avoid reaching the API limit
  for (const extension of extensions) {
    // eslint-disable-next-line no-await-in-loop
    const remoteIdentifier = await uploadFunctionExtension(extension, {
      apiKey: options.identifiers.app,
      token: options.token,
      identifier: identifiers.extensions[extension.localIdentifier],
    })
    functionIds[extension.localIdentifier] = remoteIdentifier
  }

  identifiers = {
    ...identifiers,
    extensions: {
      ...identifiers.extensions,
      ...functionIds,
    },
  }

  return identifiers
}

interface UploadFunctionExtensionOptions {
  apiKey: string
  identifier?: string
  token: string
}

async function uploadFunctionExtension(
  extension: ExtensionInstance<FunctionConfigType>,
  options: UploadFunctionExtensionOptions,
): Promise<string> {
  const {url} = await uploadWasmBlob(extension.localIdentifier, extension.outputPath, options.apiKey, options.token)

  let inputQuery: string | undefined
  if (await fileExists(extension.inputQueryPath)) {
    inputQuery = await readFile(extension.inputQueryPath)
  }

  const query = AppFunctionSetMutation
  const variables: AppFunctionSetVariables = {
    // NOTE: This is a shim to support CLI projects that currently use the UUID instead of the ULID
    ...(options.identifier?.includes('-') ? {legacyUuid: options.identifier} : {id: options.identifier}),
    title: extension.configuration.name,
    description: extension.configuration.description ?? '',
    apiType: extension.configuration.type,
    apiVersion: extension.configuration.api_version,
    inputQuery,
    inputQueryVariables: extension.configuration.input?.variables
      ? {
          singleJsonMetafield: extension.configuration.input.variables,
        }
      : undefined,
    appBridge: extension.configuration.ui?.paths
      ? {
          detailsPath: extension.configuration.ui.paths.details,
          createPath: extension.configuration.ui.paths.create,
        }
      : undefined,
    enableCreationUi: extension.configuration.ui?.enable_create ?? true,
    moduleUploadUrl: url,
  }

  const res: AppFunctionSetMutationSchema = await functionProxyRequest(options.apiKey, query, options.token, variables)
  const userErrors = res.data.functionSet.userErrors ?? []
  if (userErrors.length !== 0) {
    if (userErrors.find((error) => error.tag === 'version_unsupported_error')) {
      const errorMessage = outputContent`Deployment failed due to an outdated API version`
      const tryMessage: TokenItem = {
        subdued: `Deployment failed because one or more Functions (${variables.apiType}) is targeting an unsupported API version (${variables.apiVersion}).`,
      }
      const customSections: AlertCustomSection[] = [
        {
          body: {
            list: {
              title: 'Reference',
              items: [
                {
                  link: {
                    label: 'API versioning',
                    url: 'https://shopify.dev/docs/api/usage/versioning',
                  },
                },
              ],
            },
          },
        },
      ]
      throw new AbortError(errorMessage, tryMessage, [], customSections)
    } else {
      const errorMessage = outputContent`The deployment of functions failed with the following errors:${outputToken.json(
        userErrors,
      )}`
      throw new AbortError(errorMessage)
    }
  }
  return res.data.functionSet.function?.id as string
}

export async function uploadWasmBlob(
  extensionIdentifier: string,
  wasmPath: string,
  apiKey: string,
  token: string,
): Promise<{url: string; moduleId: string}> {
  const {url, moduleId, headers, maxSize} = await getFunctionExtensionUploadURL({apiKey, token})
  headers['Content-Type'] = 'application/wasm'

  const functionContent = await readFile(wasmPath, {})
  const res = await fetch(url, {body: functionContent, headers, method: 'PUT'})
  const resBody = res.body?.read()?.toString() || ''

  if (res.status === 200) {
    return {url, moduleId}
  } else if (res.status === 400 && resBody.includes('EntityTooLarge')) {
    const errorMessage = outputContent`The size of the Wasm binary file for Function ${extensionIdentifier} is too large. It must be less than ${maxSize}.`
    throw new AbortError(errorMessage)
  } else if (res.status >= 400 && res.status < 500) {
    const errorMessage = outputContent`Something went wrong uploading the Function ${extensionIdentifier}. The server responded with status ${res.status.toString()} and body: ${resBody}`
    throw new BugError(errorMessage)
  } else {
    const errorMessage = outputContent`Something went wrong uploading the Function ${extensionIdentifier}. Try again.`
    throw new AbortError(errorMessage)
  }
}

interface GetFunctionExtensionUploadURLOptions {
  apiKey: string
  token: string
}

interface GetFunctionExtensionUploadURLOutput {
  url: string
  moduleId: string
  maxSize: string
  headers: {[key: string]: string}
}

async function getFunctionExtensionUploadURL(
  options: GetFunctionExtensionUploadURLOptions,
): Promise<GetFunctionExtensionUploadURLOutput> {
  const res: UploadUrlGenerateMutationSchema = await handlePartnersErrors(() =>
    functionProxyRequest(options.apiKey, UploadUrlGenerateMutation, options.token),
  )
  return res.data.uploadUrlGenerate
}

async function handlePartnersErrors<T>(request: () => Promise<T>): Promise<T> {
  try {
    const result = await request()
    return result
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (error.errors?.[0]?.extensions?.type === 'unsupported_client_version') {
      const packageManager = await getPackageManager(cwd())

      throw new AbortError(['Upgrade your CLI version to run the', {command: 'deploy'}, 'command.'], null, [
        ['Run', {command: formatPackageManagerCommand(packageManager, 'shopify upgrade')}],
      ])
    }

    throw error
  }
}
