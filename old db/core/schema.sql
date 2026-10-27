USE pos_store;
GO

CREATE TABLE EMPLOYEE(
    Employee_id     INT IDENTITY(1000000,1)       NOT NULL,
    FirstName       NVARCHAR(50)            NOT NULL,
    LastName        NVARCHAR(50)            NOT NULL,
    Email           VARCHAR(100)            NOT NULL,
    Phone_number    VARCHAR(10)             NOT NULL
        CHECK(LEN(Phone_number) = 10 AND Phone_number NOT LIKE '%[^0-9]%'),
    Role            VARCHAR(50)             NOT NULL,
    Hire_date       DATE                    NOT NULL,
    Password_hash   VARCHAR(255)            NOT NULL,
    Supervisor_id   INT                     NULL,
    CONSTRAINT PK_EMPLOYEE PRIMARY KEY (Employee_id),
    CONSTRAINT CK_Employee_Id_7digits CHECK (Employee_id BETWEEN 1000000 AND 9999999),
    CONSTRAINT UQ_EMPLOYEE_Email UNIQUE (Email),
    CONSTRAINT CK_EMPLOYEE_Role CHECK (Role IN ('Manager', 'Staff')),
    CONSTRAINT CK_EMPLOYEE_NotOwnSupervisor CHECK (Supervisor_id <> Employee_id),
    CONSTRAINT FK_EMPLOYEE_Supervisor FOREIGN KEY (Supervisor_id) REFERENCES EMPLOYEE(Employee_id)
);
GO

CREATE TABLE REWARD_PROGRAM(
    Program_id      INT IDENTITY(1000000,1)       NOT NULL,
    Program_name   NVARCHAR(100)           NOT NULL,
    Points_per_dollar DECIMAL(6,2) NOT NULL,
    Redemption_rate DECIMAL(8,4) NOT NULL,
    Effective_from DATE NOT NULL,
    Effective_to DATE NULL,
    CONSTRAINT PK_REWARD_PROGRAM PRIMARY KEY (Program_id),
    CONSTRAINT CK_REWARD_PROGRAM_ID CHECK (Program_id BETWEEN 1000000 AND 9999999),
    CONSTRAINT CK_REWARD_PROGRAM_Rates CHECK (Points_per_dollar >= 0 AND Redemption_rate >= 0),
    CONSTRAINT CK_REWARD_PROGRAM_Dates CHECK (Effective_to IS NULL OR Effective_to >= Effective_from)
);
GO

CREATE TABLE SALE_EVENT(
    Sale_event_id INT IDENTITY(1000000,1) NOT NULL,
    Event_name NVARCHAR(100) NOT NULL,
    Description NVARCHAR(500) NULL,
    Start_date DATE NOT NULL,
    End_date DATE NOT NULL,
    Is_active BIT NOT NULL DEFAULT 1,
    CONSTRAINT PK_SALE_EVENT PRIMARY KEY (Sale_event_id),
    CONSTRAINT CK_SALE_EVENT_ID CHECK (Sale_event_id BETWEEN 1000000 AND 9999999),
    CONSTRAINT CK_SALE_EVENT_Dates CHECK (End_date >= Start_date)
);
GO

CREATE TABLE SUPPLIER(
    Supplier_id INT IDENTITY(1000000,1) NOT NULL,
    Supplier_name NVARCHAR(100) NOT NULL,
    Supplier_email VARCHAR(100) NOT NULL,
    Supplier_phone VARCHAR(10) NOT NULL
        CHECK(LEN(Supplier_phone) = 10 AND Supplier_phone NOT LIKE '%[^0-9]%'),
    Street_address NVARCHAR(200) NOT NULL,
    Apt_number NVARCHAR(10) NULL,
    City NVARCHAR(50) NOT NULL,
    State NVARCHAR(2) NOT NULL,
    Zip_code VARCHAR(10) NOT NULL
        CHECK(LEN(Zip_code) BETWEEN 5 AND 10 AND Zip_code NOT LIKE '%[^0-9]%'),
    CONSTRAINT PK_SUPPLIER PRIMARY KEY (Supplier_id),
    CONSTRAINT CK_SUPPLIER_ID CHECK (Supplier_id BETWEEN 1000000 AND 9999999),
    CONSTRAINT UQ_SUPPLIER_Email UNIQUE (Supplier_email)
);
GO

CREATE TABLE REGISTER(
    Register_id INT IDENTITY(1000000,1) NOT NULL,
    Register_number INT NOT NULL,
    Is_active BIT NOT NULL DEFAULT 1,
    CONSTRAINT PK_REGISTER PRIMARY KEY (Register_id),
    CONSTRAINT UQ_REGISTER_Number UNIQUE (Register_number),
    CONSTRAINT CK_REGISTER_ID CHECK (Register_id BETWEEN 1000000 AND 9999999)
);
GO

CREATE TABLE REWARD_TIER(
    Tier_id INT IDENTITY(1000000,1) NOT NULL,
    Program_id INT NOT NULL,
    Tier_name NVARCHAR(50) NOT NULL,
    Min_points INT NOT NULL,
    Perk_description NVARCHAR(200) NULL,
    CONSTRAINT PK_REWARD_TIER PRIMARY KEY (Tier_id),
    CONSTRAINT CK_REWARD_TIER_ID CHECK (Tier_id BETWEEN 1000000 AND 9999999),
    CONSTRAINT CK_REWARD_TIER_MinPoints CHECK (Min_points >= 0),
    CONSTRAINT UQ_REWARD_TIER_Program_Min UNIQUE (Program_id, Min_points),
    CONSTRAINT FK_REWARD_TIER_Program FOREIGN KEY (Program_id) REFERENCES REWARD_PROGRAM(Program_id),
);
GO

CREATE TABLE DISCOUNT(
    Discount_id         INT IDENTITY(1000000,1) NOT NULL,
    Discount_name       NVARCHAR(100)           NOT NULL,
    Discount_type       VARCHAR(30)             NOT NULL,
    Code                VARCHAR(30)             NULL,
    Amount              DECIMAL(10,2)           NOT NULL,
    Amount_type         VARCHAR(10)             NOT NULL,
    Start_date          DATE                    NOT NULL,
    End_date            DATE                    NOT NULL,
    Sale_event_id       INT                     NULL,
    CONSTRAINT PK_DISCOUNT PRIMARY KEY (Discount_id),
    CONSTRAINT CK_DISCOUNT_ID CHECK (Discount_id BETWEEN 1000000 AND 9999999),
    CONSTRAINT CK_DISCOUNT_Amount CHECK (Amount >=0 ),
    CONSTRAINT CK_DISCOUNT_AmountType CHECK (Amount_Type IN('percent', 'fixed')),
    CONSTRAINT CK_DISCOUNT_Dates CHECK (End_date >= Start_date),
    CONSTRAINT FK_DISCOUNT_Sale_event_id FOREIGN KEY (Sale_event_id) REFERENCES Sale_event(Sale_event_id),
);
GO

CREATE UNIQUE INDEX UX_Discount_Code ON Discount(Code) WHERE Code IS NOT NULL;
GO

CREATE TABLE CUSTOMER(
    Customer_id     INT IDENTITY(1000000,1) NOT NULL,
    First_name      NVARCHAR(50)  NOT NULL,
    Last_name       NVARCHAR(50)  NOT NULL,
    Email           VARCHAR(100)  NOT NULL,
    Loyalty_points  INT           NOT NULL DEFAULT 0,
    Street_number   NVARCHAR(100) NOT NULL,
    Apt_number      VARCHAR(10)   NULL,
    City            NVARCHAR(50)  NOT NULL,
    State           CHAR(2)       NOT NULL,
    Zip_code        VARCHAR(10)   NOT NULL,
    Created_date    DATE          NOT NULL DEFAULT CAST(SYSDATETIME() AS DATE),
    Referred_by_id  INT           NULL,
    Tier_id         INT           NULL,
    CONSTRAINT PK_CUSTOMER PRIMARY KEY (Customer_id),
    CONSTRAINT CK_CUSTOMER_Id_7digits CHECK (Customer_id BETWEEN 1000000 AND 9999999),
    CONSTRAINT UQ_CUSTOMER_Email UNIQUE (Email),
    CONSTRAINT CK_CUSTOMER_Points CHECK (Loyalty_points >= 0),
    CONSTRAINT CK_CUSTOMER_NotSelfReferred CHECK (Referred_by_id <> Customer_id),
    CONSTRAINT FK_CUSTOMER_Referrer FOREIGN KEY (Referred_by_id) REFERENCES Customer(Customer_id),
    CONSTRAINT FK_CUSTOMER_Tier FOREIGN KEY (Tier_id) REFERENCES Reward_Tier(Tier_id)
);
GO

CREATE TABLE CATEGORY(
    Category_id  INT IDENTITY(1000000,1) NOT NULL,
    Name         NVARCHAR(100) NOT NULL,
    Description  NVARCHAR(500) NULL,
    Discount_id  INT           NULL,
    CONSTRAINT PK_CATEGORY PRIMARY KEY (Category_id),
    CONSTRAINT CK_CATEGORY_Id_7digits CHECK (Category_id BETWEEN 1000000 AND 9999999),
    CONSTRAINT UQ_CATEGORY_Name UNIQUE (Name),
    CONSTRAINT FK_CATEGORY_Discount FOREIGN KEY (Discount_id) REFERENCES Discount(Discount_id)
);
GO

CREATE TABLE CUSTOMER_PHONE(
    Customer_id   INT         NOT NULL,
    Phone_number  VARCHAR(20) NOT NULL,
    CONSTRAINT PK_CUSTOMER_PHONE PRIMARY KEY (Customer_id, Phone_number),
    CONSTRAINT FK_CUSTOMER_PHONE_Customer FOREIGN KEY (Customer_id) REFERENCES Customer(Customer_id)
);
GO

CREATE TABLE PRODUCT(
    Product_id         INT IDENTITY(1000000,1) NOT NULL,
    SKU                VARCHAR(50)   NOT NULL,
    Name               NVARCHAR(150) NOT NULL,
    Description        NVARCHAR(MAX) NULL,
    Cost_price         DECIMAL(10,2) NOT NULL,
    Sell_price         DECIMAL(10,2) NOT NULL,
    Stock_quantity     INT           NOT NULL DEFAULT 0,
    Reorder_threshold  INT           NOT NULL,
    Product_condition  VARCHAR(20)   NOT NULL,
    Category_id        INT           NOT NULL,
    Discount_id        INT           NULL,
    CONSTRAINT PK_PRODUCT PRIMARY KEY (Product_id),
    CONSTRAINT CK_PRODUCT_Id_7digits CHECK (Product_id BETWEEN 1000000 AND 9999999),
    CONSTRAINT UQ_PRODUCT_SKU UNIQUE (SKU),
    CONSTRAINT CK_PRODUCT_Cost CHECK (Cost_price >= 0),
    CONSTRAINT CK_PRODUCT_Price CHECK (Sell_price >= 0),
    CONSTRAINT CK_PRODUCT_Stock CHECK (Stock_quantity >= 0),
    CONSTRAINT CK_PRODUCT_Reorder CHECK (Reorder_threshold >= 0),
    CONSTRAINT CK_PRODUCT_Condition CHECK (Product_condition IN ('New','Used','Refurbished')),
    CONSTRAINT FK_PRODUCT_Category FOREIGN KEY (Category_id) REFERENCES Category(Category_id),
    CONSTRAINT FK_PRODUCT_Discount FOREIGN KEY (Discount_id) REFERENCES Discount(Discount_id)
);
GO

CREATE TABLE TAX_RATE(
    Tax_rate_id     INT IDENTITY(1000000,1) NOT NULL,
    Category_id     INT           NOT NULL,
    Rate            DECIMAL(5,4)  NOT NULL,
    Effective_from  DATE          NOT NULL,
    Effective_to    DATE          NULL,
    CONSTRAINT PK_TAX_RATE PRIMARY KEY (Tax_rate_id),
    CONSTRAINT CK_TAX_RATE_Id_7digits CHECK (Tax_rate_id BETWEEN 1000000 AND 9999999),
    CONSTRAINT CK_TAX_RATE_Range CHECK (Rate BETWEEN 0 AND 1),
    CONSTRAINT CK_TAX_RATE_Dates CHECK (Effective_to IS NULL OR Effective_to >= Effective_from),
    CONSTRAINT FK_TAX_RATE_Category FOREIGN KEY (Category_id) REFERENCES Category(Category_id)
);
GO

CREATE TABLE SUPPLIER_PRODUCT(
    Supplier_id     INT           NOT NULL,
    Product_id      INT           NOT NULL,
    Supplier_sku    VARCHAR(50)   NOT NULL,
    Unit_cost       DECIMAL(10,2) NOT NULL,
    Lead_time_days  INT           NOT NULL,
    CONSTRAINT PK_SUPPLIER_PRODUCT PRIMARY KEY (Supplier_id, Product_id),
    CONSTRAINT CK_SUPPLIER_PRODUCT_Cost CHECK (Unit_cost >= 0),
    CONSTRAINT CK_SUPPLIER_PRODUCT_Lead CHECK (Lead_time_days >= 0),
    CONSTRAINT FK_SUPPLIER_PRODUCT_Supplier FOREIGN KEY (Supplier_id) REFERENCES Supplier(Supplier_id),
    CONSTRAINT FK_SUPPLIER_PRODUCT_Product FOREIGN KEY (Product_id) REFERENCES Product(Product_id)
);
GO

CREATE TABLE SUPPLIER_ORDER(
    Order_id       INT IDENTITY(1000000,1) NOT NULL,
    Supplier_id    INT         NOT NULL,
    Employee_id    INT         NOT NULL,
    Order_date     DATE        NOT NULL,
    Received_date  DATE        NULL,
    Status         VARCHAR(20) NOT NULL,
    CONSTRAINT PK_SUPPLIER_ORDER PRIMARY KEY (Order_id),
    CONSTRAINT CK_SUPPLIER_ORDER_Id_7digits CHECK (Order_id BETWEEN 1000000 AND 9999999),
    CONSTRAINT CK_SUPPLIER_ORDER_Status CHECK (Status IN ('Pending','Ordered','Received','Cancelled')),
    CONSTRAINT CK_SUPPLIER_ORDER_Dates CHECK (Received_date IS NULL OR Received_date >= Order_date),
    CONSTRAINT FK_SUPPLIER_ORDER_Supplier FOREIGN KEY (Supplier_id) REFERENCES Supplier(Supplier_id),
    CONSTRAINT FK_SUPPLIER_ORDER_Employee FOREIGN KEY (Employee_id) REFERENCES Employee(Employee_id)
);
GO

CREATE TABLE SUPPLIER_ORDER_ITEM(
    Order_id    INT           NOT NULL,
    Product_id  INT           NOT NULL,
    Quantity    INT           NOT NULL,
    Unit_cost   DECIMAL(10,2) NOT NULL,
    CONSTRAINT PK_SUPPLIER_ORDER_ITEM PRIMARY KEY (Order_id, Product_id),
    CONSTRAINT CK_SUPPLIER_ORDER_ITEM_Qty CHECK (Quantity > 0),
    CONSTRAINT CK_SUPPLIER_ORDER_ITEM_Cost CHECK (Unit_cost >= 0),
    CONSTRAINT FK_SUPPLIER_ORDER_ITEM_Order FOREIGN KEY (Order_id) REFERENCES Supplier_Order(Order_id),
    CONSTRAINT FK_SUPPLIER_ORDER_ITEM_Product FOREIGN KEY (Product_id) REFERENCES Product(Product_id)
);
GO

CREATE TABLE LOW_STOCK_ALERT(
    Alert_id      INT IDENTITY(1000000,1) NOT NULL,
    Product_id    INT       NOT NULL,
    Triggered_at  DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    Resolved_at   DATETIME2 NULL,
    Order_id      INT       NULL,
    CONSTRAINT PK_LOW_STOCK_ALERT PRIMARY KEY (Alert_id),
    CONSTRAINT CK_LOW_STOCK_ALERT_Id_7digits CHECK (Alert_id BETWEEN 1000000 AND 9999999),
    CONSTRAINT FK_LOW_STOCK_ALERT_Product FOREIGN KEY (Product_id) REFERENCES Product(Product_id),
    CONSTRAINT FK_LOW_STOCK_ALERT_Order FOREIGN KEY (Order_id) REFERENCES Supplier_Order(Order_id)
);
GO

CREATE TABLE INVENTORY_ADJUSTMENT(
    Adjustment_id    INT IDENTITY(1000000,1) NOT NULL,
    Product_id       INT           NOT NULL,
    Employee_id      INT           NOT NULL,
    Quantity_change  INT           NOT NULL,
    Reason           NVARCHAR(200) NOT NULL,
    Adjusted_at      DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT PK_INVENTORY_ADJUSTMENT PRIMARY KEY (Adjustment_id),
    CONSTRAINT CK_INVENTORY_ADJUSTMENT_Id_7digits CHECK (Adjustment_id BETWEEN 1000000 AND 9999999),
    CONSTRAINT CK_INVENTORY_ADJUSTMENT_Change CHECK (Quantity_change <> 0),
    CONSTRAINT FK_INVENTORY_ADJUSTMENT_Product FOREIGN KEY (Product_id) REFERENCES Product(Product_id),
    CONSTRAINT FK_INVENTORY_ADJUSTMENT_Employee FOREIGN KEY (Employee_id) REFERENCES Employee(Employee_id)
);
GO

CREATE TABLE PRICE_CHANGE(
    Price_change_id  INT IDENTITY(1000000,1) NOT NULL,
    Product_id       INT           NOT NULL,
    Employee_id      INT           NOT NULL,
    Old_price        DECIMAL(10,2) NOT NULL,
    New_price        DECIMAL(10,2) NOT NULL,
    Changed_at       DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT PK_PRICE_CHANGE PRIMARY KEY (Price_change_id),
    CONSTRAINT CK_PRICE_CHANGE_Id_7digits CHECK (Price_change_id BETWEEN 1000000 AND 9999999),
    CONSTRAINT CK_PRICE_CHANGE_Old CHECK (Old_price >= 0),
    CONSTRAINT CK_PRICE_CHANGE_New CHECK (New_price >= 0),
    CONSTRAINT FK_PRICE_CHANGE_Product FOREIGN KEY (Product_id) REFERENCES Product(Product_id),
    CONSTRAINT FK_PRICE_CHANGE_Employee FOREIGN KEY (Employee_id) REFERENCES Employee(Employee_id)
);
GO

CREATE TABLE SALES_TRANSACTION(
    Transaction_id    INT IDENTITY(1000000,1) NOT NULL,
    Customer_id       INT           NULL,
    Employee_id       INT           NOT NULL,
    Register_id       INT           NOT NULL,
    Transaction_date  DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    Subtotal          DECIMAL(10,2) NOT NULL DEFAULT 0,
    Tax_amount        DECIMAL(10,2) NOT NULL DEFAULT 0,
    Total             DECIMAL(10,2) NOT NULL DEFAULT 0,
    Status            VARCHAR(10)   NOT NULL DEFAULT 'open',
    CONSTRAINT PK_SALES_TRANSACTION PRIMARY KEY (Transaction_id),
    CONSTRAINT CK_SALES_TRANSACTION_Id_7digits CHECK (Transaction_id BETWEEN 1000000 AND 9999999),
    CONSTRAINT CK_SALES_TRANSACTION_Subtotal CHECK (Subtotal >= 0),
    CONSTRAINT CK_SALES_TRANSACTION_Tax CHECK (Tax_amount >= 0),
    CONSTRAINT CK_SALES_TRANSACTION_Total CHECK (Total >= 0),
    CONSTRAINT CK_SALES_TRANSACTION_Status CHECK (Status IN ('open','completed','voided')),
    CONSTRAINT FK_SALES_TRANSACTION_Customer FOREIGN KEY (Customer_id) REFERENCES Customer(Customer_id),
    CONSTRAINT FK_SALES_TRANSACTION_Employee FOREIGN KEY (Employee_id) REFERENCES Employee(Employee_id),
    CONSTRAINT FK_SALES_TRANSACTION_Register FOREIGN KEY (Register_id) REFERENCES Register(Register_id)
);
GO

CREATE TABLE TRANSACTION_ITEM(
    Transaction_id   INT           NOT NULL,
    Product_id       INT           NOT NULL,
    Quantity         INT           NOT NULL,
    Unit_price       DECIMAL(10,2) NOT NULL,
    Discount_id      INT           NULL,
    Discount_amount  DECIMAL(10,2) NOT NULL DEFAULT 0,
    Line_total       AS (Quantity * Unit_price - Discount_amount) PERSISTED,
    CONSTRAINT PK_TRANSACTION_ITEM PRIMARY KEY (Transaction_id, Product_id),
    CONSTRAINT CK_TRANSACTION_ITEM_Qty CHECK (Quantity > 0),
    CONSTRAINT CK_TRANSACTION_ITEM_Price CHECK (Unit_price >= 0),
    CONSTRAINT CK_TRANSACTION_ITEM_Discount CHECK (Discount_amount >= 0 AND Discount_amount <= Quantity * Unit_price),
    CONSTRAINT FK_TRANSACTION_ITEM_Transaction FOREIGN KEY (Transaction_id) REFERENCES Sales_Transaction(Transaction_id),
    CONSTRAINT FK_TRANSACTION_ITEM_Product FOREIGN KEY (Product_id) REFERENCES Product(Product_id),
    CONSTRAINT FK_TRANSACTION_ITEM_Discount FOREIGN KEY (Discount_id) REFERENCES Discount(Discount_id)
);
GO

CREATE TABLE PAYMENT(
    Payment_id      INT IDENTITY(1000000,1) NOT NULL,
    Transaction_id  INT           NOT NULL,
    Method          VARCHAR(10)   NOT NULL,
    Amount          DECIMAL(10,2) NOT NULL,
    Card_last4      CHAR(4)       NULL,
    Change_given    DECIMAL(10,2) NOT NULL DEFAULT 0,
    Paid_at         DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT PK_PAYMENT PRIMARY KEY (Payment_id),
    CONSTRAINT CK_PAYMENT_Id_7digits CHECK (Payment_id BETWEEN 1000000 AND 9999999),
    CONSTRAINT CK_PAYMENT_Method CHECK (Method IN ('credit','debit','cash')),
    CONSTRAINT CK_PAYMENT_Amount CHECK (Amount > 0),
    CONSTRAINT CK_PAYMENT_Change CHECK (Change_given >= 0),
    CONSTRAINT CK_PAYMENT_Card CHECK (Card_last4 IS NULL OR Card_last4 NOT LIKE '%[^0-9]%'),
    CONSTRAINT FK_PAYMENT_Transaction FOREIGN KEY (Transaction_id) REFERENCES Sales_Transaction(Transaction_id)
);
GO

CREATE TABLE REVIEW(
    Review_id       INT IDENTITY(1000000,1) NOT NULL,
    Rating          TINYINT       NOT NULL,
    Comment         NVARCHAR(1000) NULL,
    Review_date     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    Product_id      INT           NOT NULL,
    Customer_id     INT           NOT NULL,
    Transaction_id  INT           NULL,
    CONSTRAINT PK_REVIEW PRIMARY KEY (Review_id),
    CONSTRAINT CK_REVIEW_Id_7digits CHECK (Review_id BETWEEN 1000000 AND 9999999),
    CONSTRAINT CK_REVIEW_Rating CHECK (Rating BETWEEN 1 AND 5),
    CONSTRAINT FK_REVIEW_Product FOREIGN KEY (Product_id) REFERENCES Product(Product_id),
    CONSTRAINT FK_REVIEW_Customer FOREIGN KEY (Customer_id) REFERENCES Customer(Customer_id),
    CONSTRAINT FK_REVIEW_Transaction FOREIGN KEY (Transaction_id) REFERENCES Sales_Transaction(Transaction_id)
);
GO

CREATE TABLE LOYALTY_TRANSACTION(
    Loyalty_txn_id  INT IDENTITY(1000000,1) NOT NULL,
    Customer_id     INT           NOT NULL,
    Transaction_id  INT           NULL,
    Program_id      INT           NOT NULL,
    Points_change   INT           NOT NULL,
    Reason          NVARCHAR(100) NOT NULL,
    Created_at      DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT PK_LOYALTY_TRANSACTION PRIMARY KEY (Loyalty_txn_id),
    CONSTRAINT CK_LOYALTY_TRANSACTION_Id_7digits CHECK (Loyalty_txn_id BETWEEN 1000000 AND 9999999),
    CONSTRAINT FK_LOYALTY_TRANSACTION_Customer FOREIGN KEY (Customer_id) REFERENCES Customer(Customer_id),
    CONSTRAINT FK_LOYALTY_TRANSACTION_Transaction FOREIGN KEY (Transaction_id) REFERENCES Sales_Transaction(Transaction_id),
    CONSTRAINT FK_LOYALTY_TRANSACTION_Program FOREIGN KEY (Program_id) REFERENCES Reward_Program(Program_id)
);
GO