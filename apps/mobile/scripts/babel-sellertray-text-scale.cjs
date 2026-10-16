const path = require('node:path');

const SCALE_IMPORTS = {
  Text: { exportName: 'SellerTrayText', moduleName: 'SellerTrayText' },
  TextInput: { exportName: 'SellerTrayTextInput', moduleName: 'SellerTrayTextInput' },
};

module.exports = function sellerTrayTextScalePlugin({ types: t }) {
  return {
    name: 'sellertray-text-scale',
    visitor: {
      Program(programPath, state) {
        const filename = String(state.filename || '').replace(/\\/g, '/');
        const marker = '/apps/mobile/src/';
        const markerIndex = filename.lastIndexOf(marker);
        if (
          markerIndex < 0
          || filename.endsWith('/components/SellerTrayText.tsx')
          || filename.endsWith('/components/SellerTrayTextInput.tsx')
        ) return;

        const rewritten = [];

        for (const statementPath of programPath.get('body')) {
          if (!statementPath.isImportDeclaration()) continue;
          if (statementPath.node.source.value !== 'react-native') continue;

          for (const specifierPath of statementPath.get('specifiers')) {
            if (!specifierPath.isImportSpecifier()) continue;
            const imported = specifierPath.node.imported;
            if (!t.isIdentifier(imported)) continue;
            const target = SCALE_IMPORTS[imported.name];
            if (!target) continue;
            rewritten.push({ ...target, localName: specifierPath.node.local.name });
            specifierPath.remove();
          }

          if (statementPath.node.specifiers.length === 0) statementPath.remove();
        }

        if (rewritten.length === 0) return;

        const srcRoot = filename.slice(0, markerIndex + marker.length);
        for (const item of rewritten) {
          const target = `${srcRoot}components/${item.moduleName}`;
          let relative = path.posix.relative(path.posix.dirname(filename), target);
          if (!relative.startsWith('.')) relative = `./${relative}`;

          programPath.unshiftContainer(
            'body',
            t.importDeclaration(
              [t.importSpecifier(t.identifier(item.localName), t.identifier(item.exportName))],
              t.stringLiteral(relative),
            ),
          );
        }
      },
    },
  };
};
