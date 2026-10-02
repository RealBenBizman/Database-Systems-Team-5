USE master;
GO

IF EXISTS (
    SELECT name
    FROM sys.databases
    WHERE name = N'GameStore'
)
BEGIN
    ALTER DATABASE GameStore
    SET SINGLE_USER
    WITH ROLLBACK IMMEDIATE;

    DROP DATABASE GameStore;
END
GO

CREATE DATABASE GameStore;
GO

USE GameStore;
GO

CREATE TABLE Employee (
    employee_id INT PRIMARY KEY,
    first_name NVARCHAR(50) NOT NULL,
    last_name NVARCHAR(50) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    employee_role VARCHAR(20) NOT NULL,
    supervisor_id INT NULL,

    CONSTRAINT FK_Employee_Supervisor FOREIGN KEY (supervisor_id) REFERENCES Employee(employee_id),
    CONSTRAINT CK_Employee_Role CHECK (employee_role IN ('Manager', 'Cashier'))
);
GO

CREATE TABLE Reward_Program (
    program_id INT PRIMARY KEY,
    program_name NVARCHAR(100) NOT NULL,
    discount_rate DECIMAL(5, 2) NOT NULL,
    points_per_dollar INT NOT NULL,

    CONSTRAINT CK_Reward_Points check (points_per_dollar > 0),
    CONSTRAINT CK_Reward_Discount check (discount_rate > 0)
);
GO

CREATE TABLE Reward_Tier (
    tier_id INT PRIMARY KEY,
    tier_name NVARCHAR(100) NOT NULL,
    program_id INT NOT NULL,
    min_points INT NOT NULL,
    perk_description NVARCHAR(255) NULL,

    CONSTRAINT FK_Reward_Tier_Program FOREIGN KEY (program_id) REFERENCES Reward_Program(program_id),
    CONSTRAINT CK_Reward_Tier_Points CHECK (min_points >= 0)
);
GO

CREATE TABLE Customer (
    customer_id INT PRIMARY KEY,
    first_name NVARCHAR(50) NOT NULL,
    last_name NVARCHAR(50) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone_number VARCHAR(15) NULL,
    program_id INT NULL,
    tier_id INT NULL,
    referred_by_id INT NULL,
    loyalty_points INT NOT NULL,

    CONSTRAINT FK_Customer_Program FOREIGN KEY (program_id) REFERENCES Reward_Program(program_id),
    CONSTRAINT FK_Customer_Tier FOREIGN KEY (tier_id) REFERENCES Reward_Tier(tier_id),
    CONSTRAINT FK_Customer_Referred_By FOREIGN KEY (referred_by_id) REFERENCES Customer(customer_id),
    CONSTRAINT CK_Customer_Loyalty_Points CHECK (loyalty_points >= 0),
    CONSTRAINT CK_Customer_NotSelfReferred CHECK (referred_by_id IS NULL OR referred_by_id <> customer_id)
);
GO

CREATE TABLE Sale_Event (
    sale_event_id INT PRIMARY KEY,
    sale_event_name NVARCHAR(100) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,

    CONSTRAINT CK_Sale_Event_Dates CHECK (end_date >= start_date)
);
GO

CREATE TABLE Discount (
    discount_id INT PRIMARY KEY,
    discount_name NVARCHAR(100) NOT NULL,
    discount_percent DECIMAL(5, 2) NOT NULL,
    discount_type VARCHAR(50) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    sale_event_id INT NULL,

    CONSTRAINT CK_Discount_Type CHECK (discount_type IN ('Seasonal', 'Clearance', 'Promotional', 'Member')),
    CONSTRAINT CK_Discount_Percent CHECK (discount_percent >= 0 AND discount_percent <= 100),
    CONSTRAINT CK_Discount_Dates CHECK (end_date >= start_date),
    CONSTRAINT FK_Discount_Sale_Event FOREIGN KEY (sale_event_id) REFERENCES Sale_Event(sale_event_id)
);
GO

CREATE TABLE Category (
    category_id INT PRIMARY KEY,
    category_name NVARCHAR(100) UNIQUE NOT NULL,
    description NVARCHAR(255) NULL,
    discount_id INT NULL,

    CONSTRAINT FK_Category_Discount FOREIGN KEY (discount_id) REFERENCES Discount(discount_id)
);
GO

CREATE TABLE Supplier (
    supplier_id INT PRIMARY KEY,
    supplier_name NVARCHAR(100) NOT NULL,
    email VARCHAR(100) NULL,
    phone_number VARCHAR(15) NULL
);
GO

CREATE TABLE Product (
    product_id INT PRIMARY KEY,
    sku VARCHAR(50) UNIQUE NOT NULL,
    product_name NVARCHAR(100) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    stock_quantity INT NOT NULL,
    category_id INT NOT NULL,
    supplier_id INT NOT NULL,
    discount_id INT NULL,
    reorder_threshold INT NOT NULL,

    CONSTRAINT CK_Product_Reorder_Threshold CHECK (reorder_threshold >= 0),
    CONSTRAINT FK_Product_Category FOREIGN KEY (category_id) REFERENCES Category(category_id),
    CONSTRAINT FK_Product_Supplier FOREIGN KEY (supplier_id) REFERENCES Supplier(supplier_id),
    CONSTRAINT FK_Product_Discount FOREIGN KEY (discount_id) REFERENCES Discount(discount_id),
    CONSTRAINT CK_Product_Price CHECK (price >= 0),
    CONSTRAINT CK_Product_Stock CHECK (stock_quantity >= 0)
);
GO

CREATE TABLE Low_Stock_Alert (
    alert_id INT PRIMARY KEY,
    product_id INT NOT NULL,
    alert_date DATETIME NOT NULL,
    stock_quantity INT NOT NULL,
    resolved_date DATETIME NULL,

    CONSTRAINT FK_Low_Stock_Alert_Product FOREIGN KEY (product_id) REFERENCES Product(product_id),
    CONSTRAINT CK_Low_Stock_Alert_Stock CHECK (stock_quantity >= 0)
);
GO

CREATE TABLE Sales_Transaction (
    transaction_id INT PRIMARY KEY,
    customer_id INT NULL,
    employee_id INT NOT NULL,
    transaction_date DATETIME NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,

    CONSTRAINT FK_Sales_Transaction_Customer FOREIGN KEY (customer_id) REFERENCES Customer(customer_id),
    CONSTRAINT FK_Sales_Transaction_Employee FOREIGN KEY (employee_id) REFERENCES Employee(employee_id),
    CONSTRAINT CK_Sales_Transaction_Total_Amount CHECK (total_amount >= 0)
);
GO

CREATE TABLE Sales_Transaction_Item (
    transaction_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,

    CONSTRAINT PK_Sales_Transaction_Item PRIMARY KEY (transaction_id, product_id),
    CONSTRAINT FK_Sales_Transaction_Item_Transaction FOREIGN KEY (transaction_id) REFERENCES Sales_Transaction(transaction_id),
    CONSTRAINT FK_Sales_Transaction_Item_Product FOREIGN KEY (product_id) REFERENCES Product(product_id),
    CONSTRAINT CK_Sales_Transaction_Item_Quantity CHECK (quantity > 0),
    CONSTRAINT CK_Sales_Transaction_Item_Price CHECK (unit_price >= 0)
);
GO

CREATE TABLE Review (
    review_id INT PRIMARY KEY,
    product_id INT NOT NULL,
    customer_id INT NOT NULL,
    rating INT NOT NULL,
    review_text NVARCHAR(1000) NULL,
    review_date DATETIME NOT NULL,

    CONSTRAINT FK_Review_Product FOREIGN KEY (product_id) REFERENCES Product(product_id),
    CONSTRAINT FK_Review_Customer FOREIGN KEY (customer_id) REFERENCES Customer(customer_id),
    CONSTRAINT CK_Review_Rating CHECK (rating >= 1 AND rating <= 5)
);
GO