import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import SkillTreePage from './SkillTreePage.jsx'

const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
const RootComponent = pathname === '/skill-tree' ? SkillTreePage : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootComponent />
  </StrictMode>,
)
