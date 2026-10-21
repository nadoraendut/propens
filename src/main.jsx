import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import '@fontsource-variable/plus-jakarta-sans'
import './styles.css'
import { installTableLabels } from './lib/tableLabels.js'

createRoot(document.getElementById('root')).render(<App />)

installTableLabels()
