DELETE FROM report_images;
DELETE FROM reports;
DELETE FROM categories;

INSERT INTO categories (id, name, slug) VALUES
	(1, 'Road Construction', 'road-construction'),
	(2, 'Road Accident', 'road-accident'),
	(3, 'Damaged Road', 'damaged-road'),
	(4, 'Flooded Road', 'flooded-road'),
	(5, 'Fallen Debris', 'fallen-debris'),
	(6, 'Heavy Traffic', 'heavy-traffic'),
	(7, 'Other (Inaccessible Road)', 'other-inaccessible-road'),
	(8, 'Other (Emergency)', 'other-emergency'),
	(9, 'Other (General)', 'other-general');