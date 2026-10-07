-- Category Overhaul Migration
-- Strategy:
-- 1. Insert 'Others' with explicit ID 9 first so reports can point to it.
-- 2. Update all reports to category_id 9.
-- 3. Delete all categories except ID 9.
-- 4. Insert remaining categories with explicit IDs 1-8.

-- Step 1: Ensure 'Others' exists at ID 9 with correct name/slug
INSERT OR IGNORE INTO categories (id, name, slug) VALUES (9, 'Others', 'others');
UPDATE categories SET name = 'Others', slug = 'others' WHERE id = 9;

-- Step 2: Move all reports to 'Others'
UPDATE reports SET category_id = 9;

-- Step 3: Remove old categories
DELETE FROM categories WHERE id != 9;

-- Step 4: Insert the rest with explicit IDs
INSERT OR IGNORE INTO categories (id, name, slug) VALUES
(1, 'Road Construction', 'road-construction'),
(2, 'Road Closure', 'road-closure'),
(3, 'Road Accident (Self)', 'road-accident-self'),
(4, 'Road Accident (Vehicular)', 'road-accident-vehicular'),
(5, 'Damaged Road', 'damaged-road'),
(6, 'Flooded Road', 'flooded-road'),
(7, 'Fallen Debris', 'fallen-debris'),
(8, 'Heavy Traffic', 'heavy-traffic');
