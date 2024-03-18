import express from "express"; 
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import fs from "fs";
import cors from "cors";
import morgan from "morgan";
import { MongoClient } from "mongodb";
import PropertiesReader from "properties-reader";
import { ObjectId } from "mongodb";



const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(morgan('short'));
// const PORT = 4001;


//For better Json view in browser
app.set('json spaces', 3);

app.use(bodyParser.json());
let lessonsCollection;
let ordersCollection;

// Allow access to files from root directory
app.use(express.static(__dirname));

// Serve static images from the 'pic' directory
app.use('/pic', express.static(path.join(__dirname, 'pic')));

// Static file middleware for lessons images
app.use("/pic/:imageName", (req, res, next) => {
  // Extract the image name from the request parameters
  const imageName = req.params.imageName;
  //Construct image path using dir name and img name
  const imagePath = path.join(__dirname, "pic", imageName);

  fs.access(imagePath, fs.constants.F_OK, (err) => {
    if (err) {
      // If not found, send an error message.
      console.error("Error accessing image:", err);
      res.status(404).send("Image not found");
    } else {
      // If found, proceed to the next middleware.
      next();
    }
  });
});


//------------------- MongoDB Atlas connection -----------------------//
let propertiesPath = path.resolve(__dirname, "conf/db.properties");
let properties = PropertiesReader(propertiesPath);
let dbPprefix = properties.get("db.prefix");
let dbUsername = encodeURIComponent(properties.get("db.user"));
let dbPwd = encodeURIComponent(properties.get("db.pwd"));
let dbName = properties.get("db.dbName");
let dbUrl = properties.get("db.dbUrl");
let dbParams = properties.get("db.params");
const uri = dbPprefix + dbUsername + ":" + dbPwd + dbUrl + dbParams;

const connectMongoDB = async (collectionName) => { 
  try {
    const client = await MongoClient.connect(uri);

    const db = client.db(dbName);
    console.log("Connected to MongoDB Atlas successfully.")

    // Set the lessons and orders from collections
    lessonsCollection = db.collection('lessons');
    ordersCollection = db.collection('orders'); 
    
    return db.collection(collectionName);
  } catch (err) {
    console.error('Failed to connect to MongoDB Atlas:', err);
    throw err;
  }
};

connectMongoDB();

//----------------------Setting up paramaeters--------------------//

// Middleware to initialize collection based on collectionName parameter
app.param('collectionName', async (req, res, next, collectionName) => {
  try {
    //Connect to the db using the collectionName
    req.collection = await connectMongoDB(collectionName);
    return next();
  } catch (err) {
    console.error('Error initializing collection:', err);
    res.status(500).send("Internal Server Error");
  }
});

//-------------------------- REST API -----------------------------//

// GET route that returns all the documents in the specified collection
app.get("/collections/:collectionName", async (req, res) => {
  try {
    //Get the lessons or orders from the collection stored in the request obj
    const result = await req.collection.find().toArray();
    res.json(result);
  } catch (err) {
    console.error("Error fetching data from MongoDB: ", err);
    res.status(500).send("Internal Server Error");
  }
});

//GET route that returns all the collections with its Id
app.get("/collections/:collectionName/:id", async (req, res) => {
  try {
    //Extract id from parameters and parse it to integer 
    const id = parseInt(req.params.id);

    //find a document in the collection with the specified ID
    const result = await req.collection.findOne({ id: id });
    if (result) {
      res.json(result);
    } else {
      res.status(404).send("Doucment with that Id is not found");
    }
  } catch (err) {
    console.error("Error fetching data from MongoDB:", err);
    res.status(500).send("Internal Server Error");
  }
});   

//POST for submitting orders
app.post("/submit-order", async (req, res) => {
  try {
      // Postman testing order data from the request body
      // const { name, phoneNumber, lessonId, availableInventory } = req.body;

      // Insert the order into the "orders" collection
      const result = await ordersCollection.insertOne(req.body);

      // Respond with a success message and the order ID
      res.status(201).json({ message: 'Order submitted successfully', orderId: result.insertedId });
  } catch (error) {
      console.error('Error submitting order:', error);
      res.status(500).json({ error: 'Internal Server Error' });
  }
});

//PUT for updating the lessons id and spaces when order is submitted
app.put('/collections/:collectionName', express.json(), async (req, res) => {
  const ids = req.body.id; // Array of lessonIds
  const spaces = req.body.spaces; // Array of spaces
  console.log(ids);
  try {
      const promises = ids.map(async (id, index) => {
          const lessonId = parseInt(id);
          const space = parseInt(spaces[index]);
          return req.collection.updateOne({id: lessonId}, {$inc: {availableInventory: -space}});
      });
      await Promise.all(promises);
      res.json({message: 'Lessons updated successfully'});
  } catch (err) {
      console.error('Error occurred while updating lessons...\n', err);
      res.status(500).send('Error occurred while updating lessons');
  }
});

//--------------Postman--Testing--------------//
//POST for creating lessons
app.post("/collections/:collectionName", async (req, res) => {
  try {
      // Postman testing order data from the request body
      // const { id, title, location, price, image, availableInventory } = req.body;

      // Insert the lesson into the "lessonss" collection
      const result = await lessonsCollection.insertOne(req.body);

      // Respond with a success message and the order ID
      res.status(201).json({ message: 'Lesson submitted successfully', orderId: result.insertedId });
  } catch (error) {
      console.error('Error submitting order:', error);
      res.status(500).json({ error: 'Internal Server Error' });
  }
});


//--------------Postman--Testing--------------//
// PUT for updating the lesson's id, price and availableInventory
app.put('/collections/:collectionName/:lessonId', express.json(), async (req, res) => {
  //Extract lesson id from url parameters
  const lessonId = req.params.lessonId; 
  
  //Extract new id, price, space from request body.
  const newId = req.body.id;
  const newPrice = req.body.price;
  const newAvailableInventory = req.body.availableInventory;

  try {
    const lessonObjectId = new ObjectId(lessonId);
    //Update the lesson document and find it by it objectId 
    const result = await req.collection.updateOne(
      { _id: lessonObjectId },
      {
        //Set new values
        $set: {
          id: newId,
          price: newPrice,
          availableInventory: newAvailableInventory
        }
      }
    );
    // If the update operation matches exactly one document
    if (result.matchedCount === 1) {
      res.json({ message: 'Lesson updated successfully :)' });
    } else {
      res.status(404).json({ message: 'Lesson not found' });
    }
  } catch (err) {
    console.error('Error occurred while updating lesson...\n', err);
    res.status(500).send('Error occurred while updating lesson');
  }
});

//--------------Postman--Testing--------------//
// DELETE for deleting the lessons with its Object_Id
app.delete('/collections/:collectionName/:lessonId', async (req, res) => {
  // Extract the lesson ID from the URL parameters
  const lessonId = req.params.lessonId;

  try {
    //Converts into Object ID
    const lessonObjectId = new ObjectId(lessonId);
    const result = await req.collection.deleteMany({ _id: lessonObjectId });

    if (result.deletedCount > 0) {
      res.json({ message: 'Lesson deleted successfully :)' });
    } else {
      res.status(404).json({ message: 'No lessons found for the given _id' });
    }
  } catch (err) {
    console.error('Error occurred while deleting lessons...\n', err);
    res.status(500).send('Error occurred while deleting lessons');
  }
});

//-----------Search using webservice-----------//
app.get('/:collectionName/search/:query', async (req, res) => {
  const query = req.params.query;
  const results = await req.collection.find({
      $or: [
          { title: { $regex: new RegExp(query, 'i') } },
          { location: {$regex: new RegExp(query, 'i') }}
      ]
  }).toArray();

  res.json(results);
});




//Error message
app.use((err, req, res, next) => {
    console.log(err.stack);
    res.status(500).send("Something is broken.");
});

// app.listen(PORT, () => {
//     console.log(`The server is running on port ${PORT}`);
  
// });
const port = process.env.PORT || 4001;
app.listen(port, function() {
 console.log("App started on port: " + port);
});
