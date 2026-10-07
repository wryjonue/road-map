import { lazy } from 'react';

export const Home = lazy(() => import('./pages/Home'));
export const Dashboard = lazy(() => import('./pages/Dashboard'));
export const FeedPage = lazy(() => import('./pages/FeedPage'));
export const CreateReportPage = lazy(() => import('./pages/CreateReportPage'));
export const TicketsPage = lazy(() => import('./pages/TicketsPage'));
export const MapView = lazy(() => import('./pages/MapView'));
export const About = lazy(() => import('./pages/About'));
export const SignInPage = lazy(() => import('./pages/SignInPage'));
export const SignUpPage = lazy(() => import('./pages/SignUpPage'));
export const ViewReportPage = lazy(() => import('./pages/ViewReportPage'));