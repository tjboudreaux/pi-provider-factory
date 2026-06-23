import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

import { fetchFactoryDynamicModels } from "./model-refresh";
import { CUSTOM_API, FACTORY_API, FACTORY_API_KEY, FACTORY_HEADERS, PROVIDER_ID } from "./constants";
import { getApiKey, login, refreshToken } from "./auth";
import { factoryStreamSimple } from "./router";

export default function registerFactoryProvider(pi: ExtensionAPI) {
  pi.registerProvider(PROVIDER_ID, {
    api: CUSTOM_API,
    baseUrl: FACTORY_API,
    apiKey: FACTORY_API_KEY,
    headers: FACTORY_HEADERS,
    streamSimple: factoryStreamSimple,
    fetchDynamicModels: fetchFactoryDynamicModels,
    oauth: {
      name: "Factory (Droid)",
      login,
      refreshToken,
      getApiKey,
    },
  });
}
