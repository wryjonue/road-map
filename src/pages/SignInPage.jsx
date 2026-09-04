import { SignIn } from '@clerk/react';
import styles from './SignInPage.module.css';

export default function SignInPage() {
	return <div className={styles.authPage}><SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" /></div>;
}
