import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Generates the home-screen icons and favicon from the brand mark: npm run generate-pwa-assets
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#00529B' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#00529B' } },
  },
  images: ['public/logo.svg'],
});
