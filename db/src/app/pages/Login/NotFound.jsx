import { EmptyState, Button } from '../../../shared/ui.jsx';

export default function NotFound() {
  return (
    <EmptyState title="Page not found" action={<Button to="/">Back to the home page</Button>}>
      The page you asked for does not exist.
    </EmptyState>
  );
}