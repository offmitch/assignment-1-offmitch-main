require("./utils.js");
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const saltRounds = 12;
const fs = require ('fs');

const port = process.env.PORT || 3000;

const app = express();
const path = require('path');
const Joi = require("joi");

const expireTime =  1 * 60 * 60 * 1000; 

/* secret information section */
const mongodb_host = process.env.MONGODB_HOST;
const mongodb_user = process.env.MONGODB_USER;
const mongodb_password = process.env.MONGODB_PASSWORD;
const mongodb_database = process.env.MONGODB_DATABASE;
const mongodb_session_secret = process.env.MONGODB_SESSION_SECRET;

const node_session_secret = process.env.NODE_SESSION_SECRET;
/* END secret section */

var {database} = include('databaseConnection');

const userCollection = database.db(mongodb_database).collection('users');

app.set('view engine', 'ejs');

app.use(express.urlencoded({extended: false}));

var mongoStore = MongoStore.create({
	mongoUrl: `mongodb+srv://${mongodb_user}:${mongodb_password}@${mongodb_host}/sessions`,
	crypto: {
		secret: mongodb_session_secret
	}
})

app.use(session({ 
    secret: node_session_secret,
	store: mongoStore, 
	saveUninitialized: false, 
	resave: true
}
));

function isValidSession(req) {
    if (req.session.authenticated) {
        return true;
    }
    return false;
}

function sessionValidation(req,res,next) {
    if (isValidSession(req)) {
        next();
    }
    else {
        res.redirect('/login');
    }
}


function isAdmin(req) {
    if (req.session.user_type == 'admin') {
        return true;
    }
    return false;
}

function adminAuthorization(req, res, next) {
    if (!isAdmin(req)) {
        res.status(403);
        res.render("errorMessage", {error: "Not Authorized"});
        return;
    }
    else {
        next();
    }
}


app.get('/', (req,res)=> {
    res.render("index");
})



app.get('/login', (req,res) => {
    var errorMessage = req.session.errorMessage || '';
    req.session.errorMessage = '';
    res.render("login", {errorMessage: errorMessage});
});

function requireAuth(req, res, next){
    if (!req.session.authenticated){
        res.redirect('/');
    }else {
        next();
    }
}

app.get('/nosql-injection', async (req,res) => {
	var username = req.query.user;

	if (!username) {
		res.send(`<h3>no user provided - try /nosql-injection?user=name</h3> <h3>or /nosql-injection?user[$ne]=name</h3>`);
		return;
	}
	console.log("user: "+username);

	const schema = Joi.string().max(20).required();
	const validationResult = schema.validate(username);

	//If we didn't use Joi to validate and check for a valid URL parameter below
	// we could run our userCollection.find and it would be possible to attack.
	// A URL parameter of user[$ne]=name would get executed as a MongoDB command
	// and may result in revealing information about all users or a successful
	// login without knowing the correct password.
	if (validationResult.error != null) {  
	   console.log(validationResult.error);
	   res.send("<h1 style='color:darkred;'>A NoSQL injection attack was detected!!</h1>");
	   return;
	}	

	const result = await userCollection.find({username: username}).project({username: 1, password: 1, _id: 1}).toArray();

	console.log(result);

    res.send(`<h1>Hello ${username}</h1>`);
});



app.get('/contact', (req,res) => {
    var missingEmail = req.query.missing;
   res.render("contact", {missing: missingEmail});
});

app.post('/submitEmail', (req,res) => {
    var email = req.body.email;
    if (!email) {
        res.redirect('/contact?missing=1');
    }
    else {
        res.send("Thanks for subscribing with your email: "+email);
    }
});


app.get('/createUser', (req,res) => {
 res.render("createUser");
});


app.post('/submitUser', async (req,res) => {
    var email = req.body.email;
    var username = req.body.username;
    var password = req.body.password;

	const schema = Joi.object(
		{
            email: Joi.string().email().required(),
			username: Joi.string().alphanum().max(20).required(),
			password: Joi.string().max(20).required()
		});
	
	const validationResult = schema.validate({email, username, password});
	if (validationResult.error != null) {
	   console.log(validationResult.error);
	   res.redirect("/createUser");
	   return;
   }

    var hashedPassword = await bcrypt.hash(password, saltRounds);
	
	await userCollection.insertOne({email: email, username: username, password: hashedPassword, user_type: "user"});
	console.log("Inserted user");

    req.session.authenticated = true;
    req.session.username = username;
    req.session.cookiemaxAge = expireTime;

    res.render("submitUser");

});


app.post('/loggingin', async (req, res) => {
    var email = req.body.email; 
    var password = req.body.password;

    const schema = Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().required()
    });

    const { error } = schema.validate({ email, password });

    if (error) {
        console.log(error);
        req.session.errorMessage = 'Invalid email or password';
        res.redirect("/login");
        return;
    }
    const result = await userCollection.find({email: email}).project({username: 1, password: 1, user_type: 1, _id: 1}).toArray();

    // const result = await userCollection.findOne({ email });

    console.log(result);

    if (result.length != 1) {
		console.log("user not found");
		res.redirect("/login");
		return;
	}

    if (!result) {
        req.session.errorMessage = 'Invalid email or password';
        res.redirect("/");
        return;
    }

    if (await bcrypt.compare(password, result[0].password)) {
        console.log("correct password");
        req.session.authenticated = true;
        req.session.user_type = result[0].user_type;
        req.session.cookie.maxAge = expireTime;

        res.redirect('/home');
    } else {
        req.session.errorMessage = 'Invalid email or password';
        res.redirect("/login");
    }
});

app.use('/home', sessionValidation);
app.get('/home', (req,res) => {
    if (!req.session.authenticated) {
        res.redirect('/login');
    }

    res.render("home");
});

app.get('/logout', (req,res) => {
	req.session.destroy();
    res.render("logout");
});

app.get('/member', (req, res) => {
    
    if (!req.session.authenticated) {
        res.redirect('/');
    }

    const randomNumber = Math.floor(Math.random() * 4);

    if (req.session.pageHits){
        req.session.pageHits = randomNumber;
    }else {
        req.session.pageHits = 1;
    }

    let pageHits = req.session.pageHits;

    let imageUrl;

    var username = req.session.username;


    res.render("member", {imageURL: imageUrl , pageHits: pageHits, username: username});
});

app.get('/admin', sessionValidation, adminAuthorization, async (req,res) => {
    const result = await userCollection.find().project({username: 1, _id: 1}).toArray();
 
    res.render("admin", {users: result});
});


app.use(express.static(__dirname + "/public"));


app.get("*", (req,res) => {
	res.status(404);
	res.render("404");
})

app.listen(port, () => {
	console.log("Node application listening on port "+port);
}); 