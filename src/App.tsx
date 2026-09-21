import { useCallback, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import MenuDrawer from './ui/MenuDrawer';
import { MenuContext } from './ui/menuContext';
import CameraScreen from './screens/CameraScreen';
import ReviewScreen from './screens/ReviewScreen';
import RecordsScreen from './screens/RecordsScreen';
import RecordDetailScreen from './screens/RecordDetailScreen';
import RecordEditScreen from './screens/RecordEditScreen';
import SearchScreen from './screens/SearchScreen';
import TagsScreen from './screens/TagsScreen';
import ExportScreen from './screens/ExportScreen';
import SettingsScreen from './screens/SettingsScreen';

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const openMenu = useCallback(() => setMenuOpen(true), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <MenuContext.Provider value={openMenu}>
      <div className="app">
        <Routes>
          {/* The camera is the home screen — launching Torikoto means shooting. */}
          <Route path="/" element={<CameraScreen />} />
          <Route path="/review" element={<ReviewScreen />} />
          <Route path="/records" element={<RecordsScreen />} />
          <Route path="/records/:id" element={<RecordDetailScreen />} />
          <Route path="/records/:id/edit" element={<RecordEditScreen />} />
          <Route path="/search" element={<SearchScreen />} />
          <Route path="/tags" element={<TagsScreen />} />
          <Route path="/tags/:name" element={<RecordsScreen />} />
          <Route path="/export" element={<ExportScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <MenuDrawer open={menuOpen} onClose={closeMenu} />
    </MenuContext.Provider>
  );
}
