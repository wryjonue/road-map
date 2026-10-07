import { Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import RootLayout from './components/RootLayout';
import RequireRole from './components/RequireRole';
import { About, CreateReportPage, Dashboard, FeedPage, Home, MapView, SignInPage, SignUpPage, TicketsPage, ViewReportPage } from './lazy-pages';
import { ROUTE_ENABLED } from './route-flags';

function renderPage(Page) {
	return <Suspense fallback={<p>Loading page...</p>}><Page /></Suspense>;
}

export const router = createBrowserRouter([
	{
		path: '/',
		element: <RootLayout />,
		children: [
			...(ROUTE_ENABLED.home ? [{ index: true, element: renderPage(Home) }] : [{ index: true, element: <Navigate to="/dashboard" replace /> }]),
			{ path: 'dashboard', element: renderPage(Dashboard) },
			{ path: 'feed', element: renderPage(FeedPage) },
			{ path: 'feed/create', element: renderPage(CreateReportPage) },
			{ path: 'feed/:id', element: renderPage(ViewReportPage) },
			{ path: 'create-report', element: renderPage(CreateReportPage) },
			...(ROUTE_ENABLED.tickets ? [{ path: 'tickets', element: <RequireRole roles={['authority', 'admin']}>{renderPage(TicketsPage)}</RequireRole> }] : []),
			{ path: 'sign-in/*', element: renderPage(SignInPage) },
			{ path: 'sign-up/*', element: renderPage(SignUpPage) },
			{ path: 'sign-up/verify-email-address', element: renderPage(SignUpPage) },
			{ path: 'map', element: renderPage(MapView) },
			...(ROUTE_ENABLED.about ? [{ path: 'about', element: renderPage(About) }] : []),
		],
	},
]);
