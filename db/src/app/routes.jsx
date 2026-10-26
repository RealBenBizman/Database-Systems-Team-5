/*
   THE ROUTE REGISTRY: every screen of the site is listed here, once.

   Each entry:
     path    the URL
     access  'public' (everyone) or a list of roles that may open it
     nav     the menu label; leave it out to keep the screen out of the menu
     summary one line shown on the staff dashboard
     owner   which part builds it
     element the screen

   HOW A TEAMMATE ADDS THEIR SCREEN: import it at the top, then replace the
   <Soon .../> placeholder on THEIR OWN lines with <TheirPage />. Do not touch
   other parts' lines (this keeps merges clean).
*/
import ComingSoon from './pages/ComingSoon.jsx';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import StaffLogin from './pages/StaffLogin.jsx';
import Register from './pages/Register.jsx';
import DashboardPage from '../pages/backoffice/DashboardPage.jsx';
import InventoryPage from '../pages/backoffice/InventoryPage.jsx';
import SupplierOrdersPage from '../pages/backoffice/SupplierOrdersPage.jsx';
import InventoryReportPage from '../pages/reports/InventoryReportPage.jsx';

const Soon = ComingSoon;

const CUSTOMER = ['customer'];
const STAFF = ['support', 'manager'];
const MANAGER = ['manager'];

export const routes = [
  // ---- Part 0 (lead) ----
  { path: '/', access: 'public', nav: 'Home', element: <Home />, owner: 'Part 0' },
  { path: '/login', access: 'public', element: <Login />, owner: 'Part 0' },
  { path: '/register', access: 'public', element: <Register />, owner: 'Part 0' },
  { path: '/staff/login', access: 'public', element: <StaffLogin />, owner: 'Part 0' },

  // ---- Part 1: storefront ----
  { path: '/shop', access: 'public', nav: 'Shop', element: <Soon title="Shop" owner="Part 1" />, owner: 'Part 1' },
  { path: '/shop/:id', access: 'public', element: <Soon title="Product" owner="Part 1" />, owner: 'Part 1' },
  { path: '/cart', access: 'public', nav: 'Cart', element: <Soon title="Cart" owner="Part 1" />, owner: 'Part 1' },
  { path: '/account', access: CUSTOMER, nav: 'Account', element: <Soon title="Account" owner="Part 1" />, owner: 'Part 1' },
  { path: '/notifications', access: CUSTOMER, nav: 'Notifications', element: <Soon title="Notifications" owner="Part 1" />, owner: 'Part 1' },

  // ---- Part 2: checkout and orders ----
  { path: '/checkout', access: CUSTOMER, element: <Soon title="Checkout" owner="Part 2" />, owner: 'Part 2' },
  { path: '/orders', access: CUSTOMER, nav: 'My orders', element: <Soon title="My orders" owner="Part 2" />, owner: 'Part 2' },
  { path: '/orders/:id', access: CUSTOMER, element: <Soon title="Order" owner="Part 2" />, owner: 'Part 2' },
  { path: '/staff/reports/sales', access: MANAGER, nav: 'Sales report', summary: 'Revenue, orders and units by day and category.', element: <Soon title="Sales report" owner="Part 2" />, owner: 'Part 2' },

  // ---- Part 3: returns and rewards ----
  { path: '/returns', access: CUSTOMER, nav: 'Returns', element: <Soon title="My returns" owner="Part 3" />, owner: 'Part 3' },
  { path: '/returns/new', access: CUSTOMER, element: <Soon title="Request a return" owner="Part 3" />, owner: 'Part 3' },
  { path: '/rewards', access: CUSTOMER, nav: 'Rewards', element: <Soon title="Rewards" owner="Part 3" />, owner: 'Part 3' },
  { path: '/staff/returns', access: STAFF, nav: 'Returns queue', summary: 'Approve, deny and refund customer returns.', element: <Soon title="Returns queue" owner="Part 3" />, owner: 'Part 3' },
  { path: '/staff/reports/rewards', access: MANAGER, nav: 'Rewards report', summary: 'Points, tiers and top earners.', element: <Soon title="Rewards report" owner="Part 3" />, owner: 'Part 3' },

  // ---- Part 4: back office ----
  { path: '/staff/dashboard', access: STAFF, nav: 'Alerts overview', summary: 'Open alerts, pending supplier orders and returns waiting.', element: <DashboardPage />, owner: 'Part 4' },
  { path: '/staff/inventory', access: STAFF, nav: 'Inventory', summary: 'Stock levels and low-stock alerts.', element: <InventoryPage />, owner: 'Part 4' },
  { path: '/staff/reports/inventory', access: STAFF, nav: 'Inventory report', summary: 'Stock value and status per product.', element: <InventoryReportPage />, owner: 'Part 4' },
  { path: '/staff/products', access: MANAGER, nav: 'Products', summary: 'Create and edit products, prices and discounts.', element: <Soon title="Products" owner="Part 4" />, owner: 'Part 4' },
  { path: '/staff/suppliers', access: MANAGER, nav: 'Supplier orders', summary: 'Order stock from suppliers and receive it.', element: <SupplierOrdersPage />, owner: 'Part 4' },
  { path: '/staff/customers', access: MANAGER, nav: 'Customer lookup', summary: 'Find a customer or an order.', element: <Soon title="Customer lookup" owner="Part 4" />, owner: 'Part 4' },
  { path: '/staff/settings', access: MANAGER, nav: 'Settings', summary: 'Categories, tax rates and reward programs.', element: <Soon title="Settings" owner="Part 4" />, owner: 'Part 4' },
];

// ---- menus ----
const isStaffRole = (role) => role === 'support' || role === 'manager';
const allowed = (route, role) => route.access === 'public' || (!!role && route.access.includes(role));

/* The menu items the current person sees: staff get the /staff screens, everyone else the shop. */
export function navFor(user) {
  const role = user ? user.role : null;
  const staff = isStaffRole(role);
  const items = routes.filter((r) => r.nav && r.path.startsWith('/staff') === staff && allowed(r, role));
  return items;
}