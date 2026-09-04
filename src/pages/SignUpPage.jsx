import { SignUp } from '@clerk/react';
import styles from './SignUpPage.module.css';

export default function SignUpPage() {
	return <div className={styles.authPage}><SignUp routing="path" path="/sign-up" signInUrl="/sign-in" /></div>;
}
