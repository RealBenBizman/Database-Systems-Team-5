//Name of the roles on the screen
export const ROLE_TITLES = {
    customer: 'Customer',
    support: 'Customer Support Representative',
    manager: 'Store Manager',
};

//short text for header badge
export const ROLE_BADGES = {
    customer: 'Customer',
    support: 'Customer Support',
    manager: 'Store Manager',
};

export const ROLE_BLURBS = {
    support: 'You help customers: approve, deny and refund returns, and check stock levels and ' + 'low-stock alerts to answer questions.',
    manager: 'You run the store: products and prices, stock, suppliers and supplier orders, settings, ' + 'customer and order lookup, and all reports.',
};

//what the "Your role" card shows on the staff home page
export const ROLE_CAN = {
    support: [
        'Approve, deny and refund customer returns',
        'See low-stock alerts',
        'Look up stock levels (read only)',
    ],
    manager: [
        'Everything Customer Support can do',
        'See every report',
        'Create and edit products, change prices and adjust stock',
        'Order stock from suppliers and receive it',
        'Look up any customer or order',
        'Manage categories, tax rates and reward programs',
    ],
};

export const ROLE_CANNOT = {
    support: [
        'See reports',
        'See supplier orders or supplier information',
        'See costs or margins',
        'Change prices, products or stock',
    ],
    manager: [],
};

export const roleTitle = (role) => ROLE_TITLES[role] || role;