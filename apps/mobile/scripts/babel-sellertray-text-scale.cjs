const path = require('node:path');

module.exports = function sellerTrayTextScalePlugin({ types: t }) {
  return {
    name: 'sellertray-text-scale',
    visitor: {
      Program(programPath, state) {
        const filename = String(state.filename || '').replace(/\\/g, '/');
        const marker = '/apps/mobile/src/';
        const markerIndex = filename.lastIndexOf(marker);
        if (markerIndex < 0 || filename.endsWith('/components/SellerTrayText.tsx')) return;

        let textLocalName = null;

        for (const statementPath of programPath.get('body')) {
          if (!statementPath.isImportDeclaration()) continue;
          if (statementPath.node.source.value !== 'react-native') continue;

          for (const specifierPath of statementPath.get('specifiers')) {
            if (!specifierPath.isImportSpecifier()) continue;
            const imported = specifierPath.node.imported;
            if (!t.isIdentifier(imported, { name: 'Text' })) continue;
            textLocalName = specifierPath.node.local.name;
            specifierPath.remove();
          }

          if (statementPath.node.specifiers.length === 0) statementPath.remove();
        }

        if (!textLocalName) return;

        const srcRoot = filename.slice(0, markerIndex + marker.length);
        const target = `${srcRoot}components/SellerTrayText`;
        let relative = path.posix.relative(path.posix.dirname(filename), target);
        if (!relative.startsWith('.')) relative = `./${relative}`;

        programPath.unshiftContainer(
          'body',
          t.importDeclaration(
            [t.importSpecifier(t.identifier(textLocalName), t.identifier('SellerTrayText'))],
            t.stringLiteral(relative),
          ),
        );
      },
    },
  };
};
