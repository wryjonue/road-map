import { useState } from 'react'
import './style.css'
import { createBrowserRouter, Link, NavLink, Outlet } from "react-router";
import { Show, SignIn, SignUp, UserButton } from '@clerk/react'
import { RouterProvider } from "react-router/dom";

function Header() {
	return (
		<>
			<div className="header">
				<div className="logo">
					Logo
				</div>
				<div className="header-auth-container">
					<Show when="signed-out">
						<Link to="/sign-in">Sign in</Link>
					</Show>
					<Show when="signed-in">
						<UserButton />
					</Show>
				</div>
			</div>
		</>
	);
}

function Home() {
	return (
		<>
			Hakdog
    	</>
	);
}
function About() {
	return (
		<>
			<h1>Roadmap Application</h1>
			<div>Devs</div>
		</>
	);
}

function SignInPage() {
	return <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />;
}

function SignUpPage() {
	return <SignUp routing="path" path="/sign-up" signInUrl="/sign-in"  />;
}
	

function RootLayout() {
	const [name, setName] = useState('Click to know');
	return (
		<>
			<Header/>
			<nav>
				<NavLink className="navlink" to="/">Home</NavLink>
				<NavLink className="navlink" to="/about">About</NavLink>
			</nav>
			<button
				style={{
					display: 'block',
					position: 'absolute',
					bottom: '0'
					
				}}
				onClick={async () => {
					const res = await fetch("/api/");
					const body = await res.text();
					setName(body);
					console.log(body)
				}}
			>{name}</button>
			<Outlet />
		</>
	);
}

const router = createBrowserRouter([
	{
		path: '/',
		element: <RootLayout />,
		children: [
			{ index: true, element: <Home /> },
			{ path: 'sign-in', element: <SignInPage /> },
			{ path: 'sign-up', element: <SignUpPage /> },
			{ path: 'sign-up/verify-email-address', element: <SignUpPage /> },
			{ path: 'about', element: <About /> },
		],
	},
]);

function App() {
	return <RouterProvider router={router} />;
}

export default App
