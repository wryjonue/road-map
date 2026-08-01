import { useState } from 'react'
import './App.css'
import { createBrowserRouter, Link, NavLink, Outlet } from "react-router";
import { RouterProvider } from "react-router/dom";

function Home() {
  return <h1>Home Page</h1>;
}

function About() {
  return <h2>About</h2>;
}

function RootLayout() {
  const [] = useState('');
  return (
    <>
    <nav>
      <NavLink className="navlink" to="/">Home</NavLink>
      <NavLink className="navlink" to="/about">About</NavLink>
    </nav>
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
      { path: 'about', element: <About /> },
    ],
  },
]);

function App() {
  return <RouterProvider router={router} />;
}

export default App
