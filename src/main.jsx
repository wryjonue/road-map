import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/react'
import App from './App.jsx'
import './index.css'

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const rootElement = document.getElementById('root')

console.info('[clerk-diag] app startup', {
	runtimeMode: import.meta.env.MODE,
	publishableKeyPresent: Boolean(clerkPublishableKey),
	rootElementPresent: Boolean(rootElement),
})

createRoot(rootElement).render(
	<StrictMode>
		<ClerkProvider publishableKey={clerkPublishableKey}>
			<App/>
		</ClerkProvider>
	</StrictMode>,
)
