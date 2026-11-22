/** Sample specs for the OpenAPI viewer. */

export const SHOP_API = `openapi: 3.0.3
info:
  title: Shop API
  version: 1.4.0
  description: Catalogue, checkout and customer endpoints for a small web shop.
servers:
  - url: https://api.shop.example.com/v1
    description: Production
  - url: http://localhost:8080/v1
    description: Local development
tags:
  - name: Products
    description: Browse and manage the catalogue
  - name: Orders
    description: Checkout and order history
  - name: Customers
    description: The signed-in customer
security:
  - bearerAuth: []
paths:
  /products:
    get:
      tags: [Products]
      summary: List products
      operationId: listProducts
      security: []
      parameters:
        - name: category
          in: query
          description: Only products in this category
          schema:
            $ref: '#/components/schemas/Category'
        - name: q
          in: query
          description: Free-text search over name and description
          schema:
            type: string
            example: running shoes
        - $ref: '#/components/parameters/Page'
        - $ref: '#/components/parameters/Size'
      responses:
        '200':
          description: A page of products
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ProductPage'
    post:
      tags: [Products]
      summary: Create a product
      operationId: createProduct
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ProductInput'
      responses:
        '201':
          description: The created product
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Product'
        '400':
          $ref: '#/components/responses/BadRequest'
  /products/{productId}:
    parameters:
      - name: productId
        in: path
        required: true
        description: Product id
        schema:
          type: string
          format: uuid
    get:
      tags: [Products]
      summary: Get a product
      operationId: getProduct
      security: []
      responses:
        '200':
          description: The product
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Product'
        '404':
          $ref: '#/components/responses/NotFound'
    delete:
      tags: [Products]
      summary: Delete a product
      operationId: deleteProduct
      responses:
        '204':
          description: Deleted
        '404':
          $ref: '#/components/responses/NotFound'
  /orders:
    get:
      tags: [Orders]
      summary: List my orders
      operationId: listOrders
      parameters:
        - name: status
          in: query
          schema:
            $ref: '#/components/schemas/OrderStatus'
        - name: placedAfter
          in: query
          schema:
            type: string
            format: date-time
      responses:
        '200':
          description: Orders of the current customer, newest first
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Order'
    post:
      tags: [Orders]
      summary: Place an order
      operationId: placeOrder
      parameters:
        - name: Idempotency-Key
          in: header
          required: true
          description: Retries with the same key return the original order
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/OrderRequest'
      responses:
        '201':
          description: Order placed
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Order'
        '400':
          $ref: '#/components/responses/BadRequest'
        '409':
          description: A product is out of stock
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/Problem'
  /orders/{orderId}:
    get:
      tags: [Orders]
      summary: Get an order
      operationId: getOrder
      parameters:
        - name: orderId
          in: path
          required: true
          schema:
            type: string
            example: ORD-2026-000184
      responses:
        '200':
          description: The order
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Order'
        '404':
          $ref: '#/components/responses/NotFound'
  /customers/me:
    get:
      tags: [Customers]
      summary: Current customer profile
      operationId: getMe
      responses:
        '200':
          description: The signed-in customer
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Customer'
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
  parameters:
    Page:
      name: page
      in: query
      description: Zero-based page index
      schema:
        type: integer
        minimum: 0
        default: 0
    Size:
      name: size
      in: query
      description: Page size
      schema:
        type: integer
        minimum: 1
        maximum: 100
        default: 20
  responses:
    BadRequest:
      description: Validation failed
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
    NotFound:
      description: Not found
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
  schemas:
    Category:
      type: string
      enum: [SHOES, APPAREL, ACCESSORIES]
    Money:
      type: object
      required: [amount, currency]
      properties:
        amount:
          type: number
          format: double
          example: 89.99
        currency:
          type: string
          description: ISO 4217 code
          example: EUR
    ProductInput:
      type: object
      required: [name, price, category]
      properties:
        name:
          type: string
          example: Trail Runner 3
        description:
          type: string
          example: Lightweight trail shoe with a grippy sole.
        price:
          $ref: '#/components/schemas/Money'
        category:
          $ref: '#/components/schemas/Category'
        tags:
          type: array
          items:
            type: string
          example: [running, outdoor]
        stock:
          type: integer
          minimum: 0
          example: 25
    Product:
      allOf:
        - type: object
          properties:
            id:
              type: string
              format: uuid
              readOnly: true
        - $ref: '#/components/schemas/ProductInput'
        - type: object
          properties:
            createdAt:
              type: string
              format: date-time
              readOnly: true
    ProductPage:
      type: object
      properties:
        content:
          type: array
          items:
            $ref: '#/components/schemas/Product'
        page:
          type: integer
        size:
          type: integer
          example: 20
        totalElements:
          type: integer
          format: int64
          example: 132
    OrderStatus:
      type: string
      enum: [PENDING, PAID, SHIPPED, DELIVERED, CANCELLED]
    OrderLine:
      type: object
      required: [productId, quantity]
      properties:
        productId:
          type: string
          format: uuid
        quantity:
          type: integer
          minimum: 1
          example: 2
    OrderRequest:
      type: object
      required: [items, shippingAddress]
      properties:
        items:
          type: array
          items:
            $ref: '#/components/schemas/OrderLine'
        shippingAddress:
          $ref: '#/components/schemas/Address'
        couponCode:
          type: string
          nullable: true
          example: SPRING10
        payment:
          oneOf:
            - $ref: '#/components/schemas/CardPayment'
            - $ref: '#/components/schemas/InvoicePayment'
    CardPayment:
      type: object
      properties:
        method:
          type: string
          enum: [CARD]
        token:
          type: string
          writeOnly: true
          example: tok_visa_4242
    InvoicePayment:
      type: object
      properties:
        method:
          type: string
          enum: [INVOICE]
        vatId:
          type: string
    Order:
      type: object
      properties:
        id:
          type: string
          example: ORD-2026-000184
        status:
          $ref: '#/components/schemas/OrderStatus'
        items:
          type: array
          items:
            $ref: '#/components/schemas/OrderLine'
        total:
          $ref: '#/components/schemas/Money'
        customer:
          $ref: '#/components/schemas/Customer'
        createdAt:
          type: string
          format: date-time
    Address:
      type: object
      required: [line1, city, country]
      properties:
        line1:
          type: string
          example: Hauptstrasse 12
        city:
          type: string
          example: Berlin
        postalCode:
          type: string
          example: '10115'
        country:
          type: string
          description: ISO 3166-1 alpha-2
          example: DE
    Customer:
      type: object
      properties:
        id:
          type: string
          format: uuid
        email:
          type: string
          format: email
        name:
          type: string
          example: Ada Lovelace
        addresses:
          type: array
          items:
            $ref: '#/components/schemas/Address'
        referredBy:
          $ref: '#/components/schemas/Customer'
    Problem:
      type: object
      properties:
        type:
          type: string
          format: uri
        title:
          type: string
          example: Validation failed
        status:
          type: integer
          example: 400
        detail:
          type: string
        errors:
          type: array
          items:
            type: object
            properties:
              field:
                type: string
                example: items[0].quantity
              message:
                type: string
                example: must be greater than or equal to 1
`;

export const TASKS_SWAGGER2 = `swagger: '2.0'
info:
  title: Tasks API
  version: 0.9.2
  description: A legacy Swagger 2.0 spec for a to-do service.
host: tasks.example.com
basePath: /api
schemes: [https]
consumes: [application/json]
produces: [application/json]
securityDefinitions:
  apiKey:
    type: apiKey
    in: header
    name: X-API-Key
security:
  - apiKey: []
tags:
  - name: tasks
paths:
  /tasks:
    get:
      tags: [tasks]
      summary: List tasks
      operationId: listTasks
      parameters:
        - name: done
          in: query
          type: boolean
        - name: limit
          in: query
          type: integer
          default: 50
      responses:
        '200':
          description: OK
          schema:
            type: array
            items:
              $ref: '#/definitions/Task'
    post:
      tags: [tasks]
      summary: Create a task
      operationId: createTask
      parameters:
        - name: body
          in: body
          required: true
          schema:
            $ref: '#/definitions/NewTask'
      responses:
        '201':
          description: Created
          schema:
            $ref: '#/definitions/Task'
        '422':
          description: Invalid task
          schema:
            $ref: '#/definitions/Error'
  /tasks/{id}:
    parameters:
      - name: id
        in: path
        required: true
        type: integer
        format: int64
    put:
      tags: [tasks]
      summary: Replace a task
      operationId: updateTask
      parameters:
        - name: body
          in: body
          required: true
          schema:
            $ref: '#/definitions/NewTask'
      responses:
        '200':
          description: Updated
          schema:
            $ref: '#/definitions/Task'
    delete:
      tags: [tasks]
      summary: Delete a task
      operationId: deleteTask
      responses:
        '204':
          description: Deleted
definitions:
  NewTask:
    type: object
    required: [title]
    properties:
      title:
        type: string
        example: Write release notes
      dueDate:
        type: string
        format: date
      priority:
        type: string
        enum: [low, normal, high]
        default: normal
      labels:
        type: array
        items:
          type: string
  Task:
    allOf:
      - $ref: '#/definitions/NewTask'
      - type: object
        properties:
          id:
            type: integer
            format: int64
            example: 17
          done:
            type: boolean
          subtasks:
            type: array
            items:
              $ref: '#/definitions/Task'
  Error:
    type: object
    properties:
      code:
        type: integer
        example: 422
      message:
        type: string
        example: title must not be blank
`;
