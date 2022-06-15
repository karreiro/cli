export const configurationFileNames = {
  app: 'shopify.app.toml',
  extension: {
    ui: 'shopify.ui.extension.toml',
    theme: 'shopify.theme.extension.toml',
    function: 'shopify.function.extension.toml',
  },
  web: 'shopify.web.toml',
} as const

export const dotEnvFileNames = {
  production: '.env',
}

export const environmentVariables = {
  /**
   * Environment variable to instructs the CLI on running the extensions' CLI through its sources.
   */
  useExtensionsCLISources: 'SHOPIFY_USE_EXTENSIONS_CLI_SOURCES',
} as const

export const versions = {
  extensionsBinary: 'v0.18.0',
} as const

export const blocks = {
  extensions: {
    directoryName: 'extensions',
    configurationName: configurationFileNames.extension,
  },
  functions: {
    defaultUrl: 'https://github.com/Shopify/scripts-apis-examples',
    defaultLanguage: 'wasm',
  },
  web: {
    directoryName: 'web',
    configurationName: configurationFileNames.web,
  },
} as const

/**
 * List of extensions for each category that are limited by quantity, only 1 of each is allowed per app
 */
export const limitedExtensions: {
  ui: UIExtensionTypes[]
  theme: ThemeExtensionTypes[]
  function: FunctionExtensionTypes[]
} = {
  ui: ['product_subscription', 'checkout_post_purchase', 'web_pixel_extension'],
  theme: ['theme'],
  function: [],
}

export const publicFunctionExtensions = {
  types: ['product_discounts', 'order_discounts', 'shipping_discounts'],
} as const
export const functionExtensions = {
  types: [...publicFunctionExtensions.types, 'payment_methods', 'shipping_rate_presenter'],
} as const

export const functionExtensionTemplates = [
  {name: 'Wasm', value: 'wasm'},
  {name: 'Rust', value: 'rust'},
]

export function isFunctionExtensionType(extensionType: string) {
  return (functionExtensions.types as ReadonlyArray<string>).includes(extensionType)
}

export const uiExtensions = {
  types: [
    'product_subscription',
    'checkout_ui_extension',
    'checkout_post_purchase',
    'web_pixel_extension',
    'pos_ui_extension',
  ],
} as const

export type UIExtensionTypes = typeof uiExtensions.types[number]

export const uiExtensionTemplates = [
  {name: 'React', value: 'react'},
  {name: 'vanilla JavaScript', value: 'vanilla-js'},
]

export function isUiExtensionType(extensionType: string) {
  return (uiExtensions.types as ReadonlyArray<string>).includes(extensionType)
}

export const themeExtensions = {
  types: ['theme'],
} as const

export type ThemeExtensionTypes = typeof themeExtensions.types[number]

export type FunctionExtensionTypes = typeof functionExtensions.types[number]

export const extensions = {
  types: [...themeExtensions.types, ...uiExtensions.types, ...functionExtensions.types],
  publicTypes: [...themeExtensions.types, ...uiExtensions.types, ...publicFunctionExtensions.types],
}

export type ExtensionTypes = typeof extensions.types[number]

export function extensionTypeCategory(extensionType: ExtensionTypes): 'theme' | 'function' | 'ui' {
  if (extensionType === 'theme') {
    return 'theme'
  }
  if ((functionExtensions.types as ReadonlyArray<string>).includes(extensionType)) {
    return 'function'
  }
  return 'ui'
}

/**
 * Given a extension type, it returns the extension point name that's necessary
 * when interacting when the API.
 * @param type {FunctionExtensionTypes} Function extension type.
 * @returns {string} Extension point name.
 */
export const getFunctionExtensionPointName = (type: FunctionExtensionTypes) => {
  switch (type) {
    case 'product_discounts':
      return 'PRODUCT_DISCOUNTS'
    case 'order_discounts':
      return 'ORDER_DISCOUNTS'
    case 'shipping_discounts':
      return 'SHIPPING_DISCOUNTS'
    case 'payment_methods':
      return 'PAYMENT_METHODS'
    case 'shipping_rate_presenter':
      return 'SHIPPING_METHODS'
  }
}

/**
 * Returns the runtime renderer dependency for a given UI extension type.
 * @param extensionType {UIExtensionTypes} Extension type.
 * @returns The renderer dependency that should be present in the app's package.json
 */
export function getUIExtensionRendererDependency(extensionType: UIExtensionTypes): string | undefined {
  switch (extensionType) {
    case 'product_subscription':
      return '@shopify/admin-ui-extensions-react'
    case 'checkout_ui_extension':
      return '@shopify/checkout-ui-extensions-react'
    case 'checkout_post_purchase':
      return '@shopify/post-purchase-ui-extensions-react'
    case 'pos_ui_extension':
      return '@shopify/retail-ui-extensions-react'
    case 'web_pixel_extension':
      return undefined
  }
}

export const extensionTypesHumanKeys = {
  types: [
    'web pixel',
    'post-purchase',
    'theme app extension',
    'checkout UI',
    'Shopify POS',
    'product subscription',
    'product discount',
    'order discount',
    'shipping discount',
    'payment customizations',
    'delivery option presenter',
  ],
} as const

export type ExtensionTypesHumanKeys = typeof extensionTypesHumanKeys.types[number]

export function getExtensionOutputConfig(extensionType: ExtensionTypes): {
  humanKey: ExtensionTypesHumanKeys
  helpURL?: string
  additionalHelp?: string
} {
  const discountAdditionalHelp =
    'This function will use your app’s toml file to point to the discount UI that you add to your web/ folder.'
  switch (extensionType) {
    case 'web_pixel_extension':
      return buildExtensionOutputConfig('web pixel')
    case 'checkout_post_purchase':
      return buildExtensionOutputConfig('post-purchase', 'https://shopify.dev/apps/checkout/post-purchase')
    case 'theme':
      return buildExtensionOutputConfig('theme app extension')
    case 'checkout_ui_extension':
      return buildExtensionOutputConfig('checkout UI')
    case 'product_subscription':
      return buildExtensionOutputConfig('product subscription')
    case 'pos_ui_extension':
      return buildExtensionOutputConfig('Shopify POS')
    case 'product_discounts':
      return buildExtensionOutputConfig(
        'product discount',
        'https://shopify.dev/apps/subscriptions/discounts',
        discountAdditionalHelp,
      )
    case 'order_discounts':
      return buildExtensionOutputConfig(
        'order discount',
        'https://shopify.dev/apps/subscriptions/discounts',
        discountAdditionalHelp,
      )
    case 'shipping_discounts':
      return buildExtensionOutputConfig(
        'shipping discount',
        'https://shopify.dev/apps/subscriptions/discounts',
        discountAdditionalHelp,
      )
    case 'payment_methods':
      return buildExtensionOutputConfig('payment customizations')
    case 'shipping_rate_presenter':
      return buildExtensionOutputConfig('delivery option presenter')
  }
}

export function getExtensionTypeFromHumanKey(humanKey: ExtensionTypesHumanKeys): ExtensionTypes {
  switch (humanKey) {
    case 'checkout UI':
      return 'checkout_ui_extension'
    case 'order discount':
      return 'product_discounts'
    case 'product discount':
      return 'product_discounts'
    case 'shipping discount':
      return 'shipping_discounts'
    case 'payment customizations':
      return 'payment_methods'
    case 'post-purchase':
      return 'checkout_post_purchase'
    case 'product subscription':
      return 'product_subscription'
    case 'Shopify POS':
      return 'pos_ui_extension'
    case 'delivery option presenter':
      return 'shipping_rate_presenter'
    case 'theme app extension':
      return 'theme'
    case 'web pixel':
      return 'web_pixel_extension'
  }
}

function buildExtensionOutputConfig(humanKey: ExtensionTypesHumanKeys, helpURL?: string, additionalHelp?: string) {
  return {
    humanKey,
    helpURL,
    additionalHelp,
  }
}
