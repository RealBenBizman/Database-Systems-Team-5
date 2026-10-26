import Catalog from '../pages/storefront/Catalog.jsx';
import ProductDetails from '../pages/storefront/ProductDetails.jsx';
import Cart from '../pages/storefront/Cart.jsx';
import Account from '../pages/storefront/Account.jsx';
import Notifications from '../pages/storefront/Notifications.jsx';

import ComingSoon from './pages/ComingSoon.jsx';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import StaffLogin from './pages/StaffLogin.jsx';
import Register from './pages/Register.jsx';

const Soon = ComingSoon;

const CUSTOMER = ['customer'];
const STAFF = ['support', 'manager'];
const MANAGER = ['manager'];

export const routes = [

  { path: '/', access: 'public', nav: 'Home', element: <Home />, owner: 'Part 0' },
  { path: '/login', access: 'public', element: <Login />, owner: 'Part 0' },
  { path: '/register', access: 'public', element: <Register />, owner: 'Part 0' },
  { path: '/staff/login', access: 'public', element: <StaffLogin />, owner: 'Part 0' },

  { path: '/shop', access: 'public', nav: 'Shop', element: <Catalog />, owner: 'Part 1' },
  { path: '/shop/:id', access: 'public', element: <ProductDetails />, owner: 'Part 1' },
  { path: '/cart', access: 'public', nav: 'Cart', element: <Cart />, owner: 'Part 1' },
  { path: '/account', access: CUSTOMER, nav: 'Account', element: <Account />, owner: 'Part 1' },
  { path: '/notifications', access: CUSTOMER, nav: 'Notifications', element: <Notifications />, owner: 'Part 1' },

  { path: '/checkout', access: CUSTOMER, element: <Soon title="Checkout" owner="Part 2" />, owner: 'Part 2' },
  { path: '/orders', access: CUSTOMER, nav: 'My orders', element: <Soon title="My orders" owner="Part 2" />, owner: 'Part 2' },
  { path: '/orders/:id', access: CUSTOMER, element: <Soon title="Order" owner="Part 2" />, owner: 'Part 2' },
  { path: '/staff/reports/sales', access: MANAGER, nav: 'Sales report', summary: 'Revenue, orders and units by day and category.', element: <Soon title="Sales report" owner="Part 2" />, owner: 'Part 2' },

  { path: '/returns', access: CUSTOMER, nav: 'Returns', element: <Soon title="My returns" owner="Part 3" />, owner: 'Part 3' },
  { path: '/returns/new', access: CUSTOMER, element: <Soon title="Request a return" owner="Part 3" />, owner: 'Part 3' },
  { path: '/rewards', access: CUSTOMER, nav: 'Rewards', element: <Soon title="Rewards" owner="Part 3" />, owner: 'Part 3' },
  { path: '/staff/returns', access: STAFF, nav: 'Returns queue', summary: 'Approve, deny and refund customer returns.', element: <Soon title="Returns queue" owner="Part 3" />, owner: 'Part 3' },
  { path: '/staff/reports/rewards', access: MANAGER, nav: 'Rewards report', summary: 'Points, tiers and top earners.', element: <Soon title="Rewards report" owner="Part 3" />, owner: 'Part 3' },

  { path: '/staff/inventory', access: STAFF, nav: 'Inventory', summary: 'Stock levels and low-stock alerts.', element: <Soon title="Inventory" owner="Part 4" />, owner: 'Part 4' },
  { path: '/staff/reports/inventory', access: STAFF, nav: 'Inventory report', summary: 'Stock value and status per product.', element: <Soon title="Inventory report" owner="Part 4" />, owner: 'Part 4' },
  { path: '/staff/products', access: MANAGER, nav: 'Products', summary: 'Create and edit products, prices and discounts.', element: <Soon title="Products" owner="Part 4" />, owner: 'Part 4' },
  { path: '/staff/suppliers', access: MANAGER, nav: 'Supplier orders', summary: 'Order stock from suppliers and receive it.', element: <Soon title="Supplier orders" owner="Part 4" />, owner: 'Part 4' },
  { path: '/staff/customers', access: MANAGER, nav: 'Customer lookup', summary: 'Find a customer or an order.', element: <Soon title="Customer lookup" owner="Part 4" />, owner: 'Part 4' },
  { path: '/staff/settings', access: MANAGER, nav: 'Settings', summary: 'Categories, tax rates and reward programs.', element: <Soon title="Settings" owner="Part 4" />, owner: 'Part 4' },
];

const isStaffRole = (role) => role === 'support' || role === 'manager';
const allowed = (route, role) => route.access === 'public' || (!!role && route.access.includes(role));

export function navFor(user) {
  const role = user ? user.role : null;
  const staff = isStaffRole(role);
  const items = routes.filter((r) => r.nav && r.path.startsWith('/staff') === staff && allowed(r, role));
  return items;
}