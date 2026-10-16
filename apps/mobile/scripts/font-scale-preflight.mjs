import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transformSync } from '@babel/core';

const require = createRequire(import.meta.url);
const mobileRoot = process.cwd();
const failures = [];

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

const babelConfig = readFileSync(join(mobileRoot, 'babel.config.js'), 'utf8');
const textComponent = readFileSync(join(mobileRoot, 'src/components/SellerTrayText.tsx'), 'utf8');
const appearance = readFileSync(join(mobileRoot, 'src/theme/AppearanceContext.tsx'), 'utf8');
const plugin = require(join(mobileRoot, 'scripts/babel-sellertray-text-scale.cjs'));

requireValue(
  babelConfig.includes("presets: ['babel-preset-expo']")
    && babelConfig.includes("plugins: ['./scripts/babel-sellertray-text-scale.cjs']"),
  'Expo Babel must apply the SellerTray text-scale transform',
);
requireValue(
  textComponent.includes('const { fontScale } = useSellerTrayAppearance()')
    && textComponent.includes('flatStyle.fontSize * fontScale')
    && textComponent.includes('flatStyle.lineHeight * fontScale'),
  'SellerTrayText must scale explicit font size and line height from appearance preferences',
);
requireValue(
  appearance.includes('fontScale') && appearance.includes('setFontScale'),
  'Appearance context must expose the persisted font-scale preference',
);

const probeFilename = join(mobileRoot, 'src/redesign/FontScaleProbe.tsx');
const probe = transformSync(
  "import { Text, View } from 'react-native'; export const Probe = () => <View><Text>Scaled</Text></View>;",
  {
    filename: probeFilename,
    configFile: false,
    babelrc: false,
    plugins: [plugin, ['@babel/plugin-syntax-jsx']],
  },
)?.code ?? '';

requireValue(
  probe.includes('SellerTrayText')
    && probe.includes('../components/SellerTrayText')
    && !/\{\s*Text\s*,/.test(probe)
    && probe.includes("from 'react-native'") || probe.includes('from "react-native"'),
  'SellerTray source Text imports must be rewritten to SellerTrayText while other React Native imports remain intact',
);

const wrapperFilename = join(mobileRoot, 'src/components/SellerTrayText.tsx');
const wrapperProbe = transformSync(
  "import { Text as NativeText } from 'react-native'; export const Native = NativeText;",
  {
    filename: wrapperFilename,
    configFile: false,
    babelrc: false,
    plugins: [plugin],
  },
)?.code ?? '';

requireValue(
  wrapperProbe.includes('NativeText') && wrapperProbe.includes('react-native') && !wrapperProbe.includes('SellerTrayText'),
  'SellerTrayText itself must remain bound to native Text to avoid recursive rewriting',
);

if (failures.length > 0) {
  console.error('SellerTray font scale preflight failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('SellerTray font scale preflight passed.');
