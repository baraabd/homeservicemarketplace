// The DOM export wires ReactDOM.flushSync for synchronous keyboard navigation.
import { RouterProvider } from 'react-router/dom';
import { AuthProvider } from '../lib/auth-provider';
import { router } from './routes';

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
