import { useEffect, useState } from 'react';
import ScreenHeader from '../ui/ScreenHeader';
import TagManager from '../ui/TagManager';
import { useMenu } from '../ui/menuContext';
import { loadSettings, saveSettings } from '../settings';
import { photoLibraryHint } from '../platform/photoLibrary';
import { hasGeolocation } from '../capture/geolocation';
import { checkPersistence, requestPersistence, type PersistenceState } from '../platform/storage';
import { photoUsage } from '../db/photoStore';
import { formatBytes } from '../format';
import { platformName } from '../platform/env';

function persistenceLabel(state: PersistenceState | null): string {
  switch (state) {
    case 'persisted':
      return '保護されています';
    case 'not-persisted':
      return '保護されていません';
    case 'native':
      return 'アプリ専用領域に保存';
    case 'unsupported':
      return 'この環境では確認できません';
    default:
      return '確認中…';
  }
}

function persistenceHint(state: PersistenceState | null): string {
  switch (state) {
    case 'persisted':
      return 'ブラウザが空き容量を確保するときも、この記録は自動では削除されません。';
    case 'not-persisted':
      return '端末の空き容量が少なくなると、ブラウザが記録を削除することがあります。保護を要求できます（ホーム画面に追加していると通りやすくなります）。';
    case 'native':
      return 'アプリ専用の領域に保存されているため、OSが勝手に削除することはありません。';
    case 'unsupported':
      return 'このブラウザは保護状態を扱えません。ZIPエクスポートでのバックアップをおすすめします。';
    default:
      return '';
  }
}

export default function SettingsScreen() {
  const openMenu = useMenu();
  const [settings, setSettings] = useState(loadSettings);
  const [usage, setUsage] = useState<{ count: number; bytes: number } | null>(null);
  const [persistence, setPersistence] = useState<PersistenceState | null>(null);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    let active = true;
    void photoUsage().then((u) => {
      if (active) setUsage(u);
    });
    void checkPersistence().then((state) => {
      if (active) setPersistence(state);
    });
    return () => {
      active = false;
    };
  }, []);

  const onRequestPersistence = async () => {
    setRequesting(true);
    try {
      setPersistence(await requestPersistence());
    } finally {
      setRequesting(false);
    }
  };

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
            {!settings.savePhotosToLibrary ? (
              <p className="warn-note" role="status">
                OFFの間は端末にコピーが作られません。写真はこのアプリの中だけに残るので、
                バックアップは「エクスポート」の写真付きZIPだけになります。
              </p>
            ) : null}
          </div>
        </section>

        <section className="section">
          <h2 className="field-label">位置情報</h2>
          <div className="card">
            <label style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={settings.recordLocation}
                onChange={(e) => setSettings(saveSettings({ recordLocation: e.target.checked }))}
              />
              撮影した場所を記録する
            </label>
            <p className="hint">
              {hasGeolocation()
                ? '撮影時に現在地を取得し、記録と写真のEXIFに残します。位置情報の許可は初回の撮影時に求められます。撮影ごとに記録するかどうかを切り替えられます。'
                : 'この環境では位置情報を取得できません。'}
            </p>
          </div>
        </section>

        <section className="section">
          <h2 className="field-label">保存データ</h2>
          <div className="card">
            {usage ? (
              <p style={{ margin: 0 }}>
                写真 {usage.count}枚・約{formatBytes(usage.bytes)}
              </p>
            ) : (
              <p style={{ margin: 0 }}>計算中…</p>
            )}

            <p style={{ margin: '12px 0 0' }}>
              自動削除からの保護：
              <strong>{persistenceLabel(persistence)}</strong>
            </p>
            <p className="hint">{persistenceHint(persistence)}</p>

            {persistence === 'not-persisted' ? (
              <button
                className="button block"
                style={{ marginTop: 10 }}
                disabled={requesting}
                onClick={() => void onRequestPersistence()}
              >
                {requesting ? '要求中…' : 'データを保護する'}
              </button>
            ) : null}

            <p className="hint">バックアップは「エクスポート」からZIPで取り出せます。</p>
          </div>
        </section>

        <section className="section">
          <h2 className="field-label">アプリ情報</h2>
          <div className="card">
            <p style={{ margin: 0 }}>トリコト v1.0 / {platformName()}</p>
            <p className="hint">写真を撮ったついでに、一言残す。</p>
          </div>
        </section>
      </div>
    </div>
  );
}
