import React, { useEffect, useState } from 'react';
import type { Settings } from '../../shared/types';
import { useToast } from '../components/Toast';

const SettingsPage: React.FC = () => {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<Settings>({
    theme: 'dark',
    download_folder: '',
    python_path: 'python',
    auto_start: false,
    notifications: true,
  });

  useEffect(() => {
    window.electronAPI.settings.get().then(setSettings);
  }, []);

  const handleSave = async () => {
    await window.electronAPI.settings.save(settings);
    showToast('Settings saved!', 'success');
  };

  const handleChange = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="p-8 space-y-8 max-w-2xl">
      <h2 className="text-2xl font-bold">Settings</h2>

      <div className="bg-gray-800 rounded-xl shadow p-6 space-y-6">
        <h3 className="text-lg font-semibold border-b border-gray-700 pb-3">Appearance</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Theme</p>
            <p className="text-sm text-gray-400">Choose dark or light mode</p>
          </div>
          <div className="flex gap-2">
            {(['dark', 'light'] as const).map((t) => (
              <button
                key={t}
                onClick={() => handleChange('theme', t)}
                className={`px-4 py-2 rounded-lg text-sm capitalize transition-colors ${settings.theme === t ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl shadow p-6 space-y-6">
        <h3 className="text-lg font-semibold border-b border-gray-700 pb-3">Automation</h3>

        <div>
          <label className="block text-sm font-medium mb-1">Default Download Folder</label>
          <div className="flex gap-2">
            <input
              value={settings.download_folder}
              onChange={(e) => handleChange('download_folder', e.target.value)}
              placeholder="e.g. C:\Users\You\Downloads"
              className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Python Path</label>
          <div className="flex gap-2">
            <input
              value={settings.python_path}
              onChange={(e) => handleChange('python_path', e.target.value)}
              placeholder="python or full path to python.exe"
              className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <p className="text-xs text-gray-400 mt-1">Used to run automation scripts</p>
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl shadow p-6 space-y-6">
        <h3 className="text-lg font-semibold border-b border-gray-700 pb-3">System</h3>

        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Auto Start on Windows Startup</p>
            <p className="text-sm text-gray-400">Launch when Windows starts</p>
          </div>
          <button
            onClick={() => handleChange('auto_start', !settings.auto_start)}
            className={`w-12 h-6 rounded-full transition-colors relative ${settings.auto_start ? 'bg-blue-600' : 'bg-gray-600'}`}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settings.auto_start ? 'left-7' : 'left-1'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Notifications</p>
            <p className="text-sm text-gray-400">Show task completion notifications</p>
          </div>
          <button
            onClick={() => handleChange('notifications', !settings.notifications)}
            className={`w-12 h-6 rounded-full transition-colors relative ${settings.notifications ? 'bg-blue-600' : 'bg-gray-600'}`}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settings.notifications ? 'left-7' : 'left-1'}`} />
          </button>
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl shadow p-6 space-y-4">
        <h3 className="text-lg font-semibold border-b border-gray-700 pb-3">Database</h3>
        <button
          onClick={() => showToast('Database backup not yet implemented for this platform', 'info')}
          className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm"
        >
          Backup Database
        </button>
      </div>

      <button
        onClick={handleSave}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-medium transition-colors"
      >
        Save Settings
      </button>
    </div>
  );
};

export default SettingsPage;
