/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_YANDEX_MAPS_API_KEY?: string;
    readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
