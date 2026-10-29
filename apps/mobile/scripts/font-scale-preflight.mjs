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
const inputComponent = readFileSync(join(mobileRoot, 'src/components/SellerTrayTextInput.tsx'), 'utf8');
const appearance = readFileSync(join(mobileRoot, 'src/theme/AppearanceContext.tsx'), 'utf8');
const typography = readFileSync(join(mobileRoot, 'src/theme/typography.ts'), 'utf8');
const plugin = require(join(mobileRoot, 'scripts/babel-sellertray-text-scale.cjs'));

requireValue(
  babelConfig.includes("presets: ['babel-preset-expo']")
    && babelConfig.includes("plugins: ['./scripts/babel-sellertray-text-scale.cjs']"),
  'Expo Babel must apply the SellerTray text-scale transform',
);
requireValue(
  typography.includes('SELLERTRAY_MIN_READABLE_FONT_SIZE = 14')
    && typography.includes('sellerTrayScaledFontSize')
    && typography.includes('Math.max(')
    && typography.includes('fontSize * fontScale'),
  'SellerTray typography authority must enforce the shared 14sp readable floor while preserving user scaling',
);
requireValue(
  textComponent.includes('const { fontScale } = useSellerTrayAppearance()')
    && textComponent.includes('sellerTrayScaledFontSize(flatStyle.fontSize, fontScale)')
    && textComponent.includes('sellerTrayScaledLineHeight(flatStyle.lineHeight, fontScale, scaledFontSize ?? 0)'),
  'SellerTrayText must use shared readable font-size and line-height scaling',
);
requireValue(
  inputComponent.includes('const { fontScale } = useSellerTrayAppearance()')
    && inputComponent.includes('sellerTrayScaledFontSize(flatStyle.fontSize, fontScale)')
    && inputComponent.includes('sellerTrayScaledLineHeight(flatStyle.lineHeight, fontScale, scaledFontSize ?? 0)'),
  'SellerTrayTextInput must use the same shared readable floor and line-height scaling as text',
);
requireValue(
  appearance.includes('fontScale') && appearance.includes('setFontScale'),
  'Appearance context must expose the persisted font-scale preference',
);

const probeFilename = join(mobileRoot, 'src/redesign/FontScaleProbe.tsx');
const probe = transformSync(
  "import { Text, TextInput, View } from 'react-native'; export const Label = Text; export const Input = TextInput; export const Other = View;",
  {
    filename: probeFilename,
    configFile: false,
    babelrc: false,
    plugins: [plugin],
  },
)?.code ?? '';

requireValue(
  probe.includes('SellerTrayText')
    && probe.includes('../components/SellerTrayText')
    && probe.includes('SellerTrayTextInput')
    && probe.includes('../components/SellerTrayTextInput')
    && (probe.includes("from 'react-native'") || probe.includes('from "react-native"')),
  'SellerTray source Text and TextInput imports must be rewritten while other React Native imports remain intact',
);

const textWrapperFilename = join(mobileRoot, 'src/components/SellerTrayText.tsx');
const textWrapperProbe = transformSync(
  "import { Text as NativeText } from 'react-native'; export const Native = NativeText;",
  {
    filename: textWrapperFilename,
    configFile: false,
    babelrc: false,
    plugins: [plugin],
  },
)?.code ?? '';
requireValue(
  textWrapperProbe.includes('NativeText') && textWrapperProbe.includes('react-native') && !textWrapperProbe.includes('SellerTrayTextInput'),
  'SellerTrayText itself must remain bound to native Text to avoid recursive rewriting',
);

const inputWrapperFilename = join(mobileRoot, 'src/components/SellerTrayTextInput.tsx');
const inputWrapperProbe = transformSync(
  "import { TextInput as NativeTextInput } from 'react-native'; export const Native = NativeTextInput;",
  {
    filename: inputWrapperFilename,
    configFile: false,
    babelrc: false,
    plugins: [plugin],
  },
)?.code ?? '';
requireValue(
  inputWrapperProbe.includes('NativeTextInput') && inputWrapperProbe.includes('react-native') && !inputWrapperProbe.includes('SellerTrayTextInput'),
  'SellerTrayTextInput itself must remain bound to native TextInput to avoid recursive rewriting',
);

if (failures.length > 0) {
  console.error('SellerTray font scale preflight failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('SellerTray font scale preflight passed.');
