// app.js
const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');

const app = express();

// ---- CONFIG ----
const PORT = 3000;

const pool = mysql.createPool({
  host: 'localhost',
  user: 'your_mysql_user',
  password: 'your_mysql_password',
  database: 'your_database_name',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// ---- MIDDLEWARE ----
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---- HOME ----
app.get('/', (req, res) => {
  res.render('index');
});


// =====================================================================
// 1) ADD NEW DRIVER (License + Contract + Driver)
// =====================================================================
app.get('/driver/new', async (req, res) => {
  const [hubs] = await pool.query(
    'SELECT hubID, city, province FROM Hub ORDER BY hubID'
  );
  res.render('addDriver', { hubs, message: null });
});

app.post('/driver/new', async (req, res) => {
  const {
    fName,
    lName,
    telNo,
    email,
    hubID,
    licenseType,
    licenseExpiry,
    contractStart,
    contractLength
  } = req.body;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Insert into DriverLicense
    const [licenseResult] = await conn.query(
      `INSERT INTO DriverLicense (expiryDate, licenseType)
       VALUES (?, ?)`,
      [licenseExpiry, licenseType]
    );
    const licenseNo = licenseResult.insertId;

    // Insert into DriverContract
    const [contractResult] = await conn.query(
      `INSERT INTO DriverContract (contractStartDate, contractLength)
       VALUES (?, ?)`,
      [contractStart, contractLength]
    );
    const contractID = contractResult.insertId;

    // Insert into Driver
    const [driverResult] = await conn.query(
      `INSERT INTO Driver
         (fName, lName, telNo, email, licenseNo, contractID, hubID)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [fName, lName, telNo, email, licenseNo, contractID, hubID]
    );
    const driverID = driverResult.insertId;

    await conn.commit();

    // Redirect to validation page
    res.redirect(`/driver/${driverID}`);
  } catch (err) {
    await conn.rollback();
    console.error(err);
    const [hubs] = await pool.query(
      'SELECT hubID, city, province FROM Hub ORDER BY hubID'
    );
    res.render('addDriver', {
      hubs,
      message: 'Error creating driver: ' + err.message
    });
  } finally {
    conn.release();
  }
});

app.get('/driver/:driverID', async (req, res) => {
  const driverID = req.params.driverID;
  const [rows] = await pool.query(
    `SELECT d.driverID, d.fName, d.lName, d.telNo, d.email, d.availabilityStatus,
            dl.licenseNo, dl.expiryDate, dl.licenseType,
            dc.contractID, dc.contractStartDate, dc.contractEndDate,
            h.hubID, h.city, h.province
     FROM Driver d
     JOIN DriverLicense dl ON d.licenseNo = dl.licenseNo
     JOIN DriverContract dc ON d.contractID = dc.contractID
     JOIN Hub h ON d.hubID = h.hubID
     WHERE d.driverID = ?`,
    [driverID]
  );
  const driver = rows[0] || null;
  res.render('viewDriver', { driver });
});


// =====================================================================
// 2) SCHEDULE TRIP & ASSIGN DRIVER + VEHICLE
// =====================================================================
app.get('/trip/new', async (req, res) => {
  const [hubs] = await pool.query(
    'SELECT hubID, city, province FROM Hub ORDER BY hubID'
  );
  const [drivers] = await pool.query(
    'SELECT driverID, fName, lName FROM Driver ORDER BY fName'
  );
  const [vehicles] = await pool.query(
    'SELECT vehicleID, make, model FROM Vehicle ORDER BY vehicleID'
  );
  res.render('newTrip', {
    hubs,
    drivers,
    vehicles,
    message: null
  });
});

app.post('/trip/new', async (req, res) => {
  const { hubID, driverID, vehicleID, dateDispatched } = req.body;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Create DeliveryTrip
    const [tripResult] = await conn.query(
      `INSERT INTO DeliveryTrip (hubID, dateDispatched, tripStatus)
       VALUES (?, ?, 'Scheduled')`,
      [hubID, dateDispatched]
    );
    const tripID = tripResult.insertId;

    // Assign driver + vehicle
    await conn.query(
      `INSERT INTO Assignment (tripID, vehicleID, driverID)
       VALUES (?, ?, ?)`,
      [tripID, vehicleID, driverID]
    );

    await conn.commit();
    res.redirect(`/trip/${tripID}`);
  } catch (err) {
    await conn.rollback();
    console.error(err);

    const [hubs] = await pool.query(
      'SELECT hubID, city, province FROM Hub ORDER BY hubID'
    );
    const [drivers] = await pool.query(
      'SELECT driverID, fName, lName FROM Driver ORDER BY fName'
    );
    const [vehicles] = await pool.query(
      'SELECT vehicleID, make, model FROM Vehicle ORDER BY vehicleID'
    );

    res.render('newTrip', {
      hubs,
      drivers,
      vehicles,
      message: 'Error creating trip: ' + err.message
    });
  } finally {
    conn.release();
  }
});

app.get('/trip/:tripID', async (req, res) => {
  const tripID = req.params.tripID;
  const [rows] = await pool.query(
    `SELECT t.tripID, t.hubID, t.dateDispatched, t.dateCompleted, t.tripStatus,
            d.driverID, d.fName, d.lName, d.availabilityStatus,
            v.vehicleID, v.make, v.model, v.vehicleStatus
     FROM DeliveryTrip t
     JOIN Assignment a ON t.tripID = a.tripID
     JOIN Driver d ON a.driverID = d.driverID
     JOIN Vehicle v ON a.vehicleID = v.vehicleID
     WHERE t.tripID = ?`,
    [tripID]
  );
  res.render('viewTrip', { records: rows });
});


// =====================================================================
// 3) RECORD VEHICLE MAINTENANCE ACTIVITY
// =====================================================================
app.get('/maintenance/new', async (req, res) => {
  const [vehicles] = await pool.query(
    'SELECT vehicleID, make, model FROM Vehicle ORDER BY vehicleID'
  );
  res.render('maintenanceNew', {
    vehicles,
    message: null
  });
});

app.post('/maintenance/new', async (req, res) => {
  const {
    vehicleID,
    maintenanceType,
    cost,
    serviceProvider,
    maintenanceDescription,
    maintenanceDate,
    maintenanceTime,
    isInService
  } = req.body;

  try {
    await pool.query(
      `INSERT INTO MaintenanceActivity
         (vehicleID, maintenanceType, cost, serviceProvider,
          maintenanceDescription, maintenanceDate, maintenanceTime, isInService)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        vehicleID,
        maintenanceType,
        cost || null,
        serviceProvider || null,
        maintenanceDescription || null,
        maintenanceDate,
        maintenanceTime || null,
        isInService === 'on' ? 1 : 0
      ]
    );
    // Trigger will recompute vehicle status
    res.redirect(`/vehicle/${vehicleID}`);
  } catch (err) {
    console.error(err);
    const [vehicles] = await pool.query(
      'SELECT vehicleID, make, model FROM Vehicle ORDER BY vehicleID'
    );
    res.render('maintenanceNew', {
      vehicles,
      message: 'Error saving maintenance: ' + err.message
    });
  }
});

app.get('/vehicle/:vehicleID', async (req, res) => {
  const vehicleID = req.params.vehicleID;
  const [rows] = await pool.query(
    `SELECT v.vehicleID, v.make, v.model, v.vehicleStatus, v.isRetired,
            ma.activityID, ma.maintenanceType, ma.cost, ma.serviceProvider,
            ma.maintenanceDate, ma.maintenanceTime, ma.isInService
     FROM Vehicle v
     LEFT JOIN MaintenanceActivity ma
       ON v.vehicleID = ma.vehicleID
     WHERE v.vehicleID = ?
     ORDER BY ma.maintenanceDate DESC, ma.maintenanceTime DESC`,
    [vehicleID]
  );
  res.render('viewVehicle', { records: rows });
});


// =====================================================================
// 4) FIND AVAILABLE DRIVERS BY HUB & DATE  (INTERESTING QUERY #1)
// =====================================================================
app.get('/drivers/available', async (req, res) => {
  const [hubs] = await pool.query(
    'SELECT hubID, city, province FROM Hub ORDER BY hubID'
  );

  const { hubID, refDate } = req.query;
  let drivers = [];

  if (hubID && refDate) {
    const [rows] = await pool.query(
      `SELECT d.driverID,
              d.fName,
              d.lName,
              d.telNo,
              d.email,
              h.city,
              h.province,
              dl.expiryDate,
              dc.contractEndDate
       FROM Driver d
       JOIN Hub h ON d.hubID = h.hubID
       JOIN DriverLicense dl ON d.licenseNo = dl.licenseNo
       JOIN DriverContract dc ON d.contractID = dc.contractID
       WHERE d.hubID = ?
         AND dl.expiryDate >= ?
         AND dc.contractEndDate >= ?
         AND d.manualUnavailable = FALSE
         AND NOT EXISTS (
           SELECT 1
           FROM Assignment a
           JOIN DeliveryTrip t ON a.tripID = t.tripID
           WHERE a.driverID = d.driverID
             AND t.dateCompleted IS NULL
         )`,
      [hubID, refDate, refDate]
    );
    drivers = rows;
  }

  res.render('driversAvailable', {
    hubs,
    selectedHub: hubID || '',
    selectedDate: refDate || '',
    drivers
  });
});


// =====================================================================
// 5) HUB STATS DASHBOARD (INTERESTING QUERY #2)
// =====================================================================
app.get('/hubs/stats', async (req, res) => {
  const sortBy = req.query.sortBy || 'hubID';
  let orderClause = 'h.hubID';

  if (sortBy === 'packages') {
    orderClause = 'totalPackages DESC';
  } else if (sortBy === 'trips') {
    orderClause = 'completedTrips DESC';
  }

  const [stats] = await pool.query(
    `SELECT h.hubID,
            h.city,
            h.province,
            COUNT(DISTINCT j.jobID) AS totalJobs,
            COUNT(DISTINCT p.packageID) AS totalPackages,
            IFNULL(SUM(p.weight), 0) AS totalWeight,
            IFNULL(SUM(p.volume), 0) AS totalVolume,
            COUNT(DISTINCT CASE WHEN t.tripStatus = 'Scheduled'
                                  AND t.dateCompleted IS NULL
                                THEN t.tripID END) AS activeTrips,
            COUNT(DISTINCT CASE WHEN t.dateCompleted IS NOT NULL
                                THEN t.tripID END) AS completedTrips
     FROM Hub h
     LEFT JOIN Job j ON j.hubID = h.hubID
     LEFT JOIN Package p ON p.jobID = j.jobID
     LEFT JOIN DeliveryTrip t ON t.hubID = h.hubID
     GROUP BY h.hubID, h.city, h.province
     ORDER BY ${orderClause}`
  );

  res.render('hubsStats', { stats, sortBy });
});

// ---- START SERVER ----
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
