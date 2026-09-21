import { useMenu } from '../ui/menuContext';

/** Phase 1 shell: chrome only. The live viewfinder arrives in Phase 2. */
export default function CameraScreen() {
  const openMenu = useMenu();

  return (
    <div className="screen">
      <div className="camera">
        <div className="camera-top">
          <button className="camera-round" onClick={openMenu} aria-label="メニューを開く">
            ☰
          </button>
        </div>
        <div className="camera-message">
          <strong>カメラ</strong>
          <span>準備中</span>
        </div>
        <div className="camera-bottom">
          <button className="shutter" aria-label="撮影" disabled />
        </div>
      </div>
    </div>
  );
}
