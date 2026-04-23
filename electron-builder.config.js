module.exports = {
  appId: 'com.windautomatex.app',
  productName: 'WindAutomateX',
  directories: {
    output: 'release',
  },
  files: ['dist/**/*', 'assets/**/*', 'python-engine/**/*'],
  win: {
    target: ['nsis', 'portable'],
    icon: 'assets/icon.ico',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: 'assets/icon.ico',
    uninstallerIcon: 'assets/icon.ico',
    installerHeaderIcon: 'assets/icon.ico',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
  extraResources: [
    {
      from: 'python-engine',
      to: 'python-engine',
      filter: ['**/*'],
    },
  ],
};
