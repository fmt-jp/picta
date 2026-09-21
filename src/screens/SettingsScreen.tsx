import { useEffect, useState } from 'react';
import ScreenHeader from '../ui/ScreenHeader';
import TagManager from '../ui/TagManager';
import { useMenu } from '../ui/menuContext';
import { loadSettings, saveSettings } from '../settings';
import { photoLibraryHint } from '../platform/photoLibrary';
import { photoUsage } from '../db/photoStore';
import { formatBytes } from '../format';
import { platformName } from '../platform/env';

export default function SettingsScreen() {
  const openMenu = useMenu();
  const [settings, setSettings] = useState(loadSettings);
  const [usage, setUsage] = useState<{ count: number; bytes: number } | null>(null);

  useEffect(() => {
    let active = true;
    void photoUsage().then((u) => {
      if (active) setUsage(u);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="screen">
      <ScreenHeader title="設定" onMenu={openMenu} />
      <div className="screen-body">
        <section className="section">
          <h2 className="field-label">タグ</h2>
          <TagManager />
        </section>

        <section className="section">
          <h2 className="field-label">端末への保存</h2>
          <div className="card">
            <label style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={settings.savePhotosToLibrary}
                onChange={(e) =>
                  setSettings(saveSettings({ savePhotosToLibrary: e.target.checked }))
                }
              />
              撮影した写真を端末にも保存する
            </label>
            <p className="hint">{photoLibraryHint()}</p>
          </div>
        </section>

        <section className="section">
          <h2 className="field-label">保存容量</h2>
          <div className="card">
            {usage ? (
              <p style={{ margin: 0 }}>
                写真 {usage.count}枚・約{formatBytes(usage.bytes)}
              </p>
            ) : (
              <p style={{ margin: 0 }}>計算中…</p>
            )}
            <p className="hint">
              バックアップは「エクスポート」からZIPで取り出せます。
            </p>
          </div>
        </section>

        <section className="section">
          <h2 className="field-label">アプリ情報</h2>
          <div className="card">
            <p style={{ margin: 0 }}>Picta v1.0 / {platformName()}</p>
            <p className="hint">写真を撮ったついでに、一言残す。</p>
          </div>
        </section>
      </div>
    </div>
  );
}
