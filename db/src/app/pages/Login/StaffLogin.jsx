// The old staff sign-in address: there is one sign-in page now, so send people there.
import { Navigate } from 'react-router-dom';
export default function StaffLogin() { return <Navigate to="/login" replace />; }
