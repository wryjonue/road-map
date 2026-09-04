import { createBrowserRouter } from 'react-router';
import RootLayout from './components/RootLayout';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import FeedPage from './pages/FeedPage';
import CreateReportPage from './pages/CreateReportPage';
import TicketsPage from './pages/TicketsPage';
import MapView from './pages/MapView';
import About from './pages/About';
import SignInPage from './pages/SignInPage';
import SignUpPage from './pages/SignUpPage';

export const router = createBrowserRouter([
	{
		path: '/',
		element: <RootLayout />,
		children: [
			{ index: true, element: <Home /> },
			{ path: 'dashboard', element: <Dashboard /> },
			{ path: 'feed', element: <FeedPage /> },
			{ path: 'feed/create', element: <CreateReportPage /> },
			{ path: 'create-report', element: <CreateReportPage /> },
			{ path: 'tickets', element: <TicketsPage /> },
			{ path: 'sign-in', element: <SignInPage /> },
			{ path: 'sign-up', element: <SignUpPage /> },
			{ path: 'sign-up/verify-email-address', element: <SignUpPage /> },
			{ path: 'map', element: <MapView /> },
			{ path: 'about', element: <About /> },
		],
	},
]);
