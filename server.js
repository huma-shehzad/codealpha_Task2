const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Post = require('./models/Post');

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session Setup
app.use(session({
    secret: 'connectify_super_secret_key',
    resave: false,
    saveUninitialized: false
}));

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Auth Guard Middleware
const isAuthenticated = async (req, res, next) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    try {
        const user = await User.findById(req.session.userId);
        if (!user) return res.redirect('/login');
        req.user = user;
        res.locals.currentUser = user;
        next();
    } catch (err) {
        console.error(err);
        res.redirect('/login');
    }
};

// --- AUTH ROUTES ---
app.get('/register', (req, res) => {
    if (req.session.userId) return res.redirect('/');
    res.render('register');
});

app.post('/register', async (req, res) => {
    try {
        const { username, email, password, avatar } = req.body;
        let existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) {
            return res.render('register', { error: 'Username or Email already exists!' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await User.create({
            username,
            email,
            password: hashedPassword,
            avatar: avatar || 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?q=80&w=400&auto=format&fit=crop'
        });

        req.session.userId = newUser._id;
        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.render('register', { error: 'Registration failed.' });
    }
});

app.get('/login', (req, res) => {
    if (req.session.userId) return res.redirect('/');
    res.render('login');
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.render('login', { error: 'Invalid email or password.' });
        }

        req.session.userId = user._id;
        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.render('login', { error: 'Login failed.' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

// --- MAIN FEED (HOME) ---
app.get('/', isAuthenticated, async (req, res) => {
    try {
        const posts = await Post.find()
            .populate('author', 'username avatar')
            .populate('comments.user', 'username avatar')
            .sort({ createdAt: -1 });

        res.render('index', {
            title: 'Connectify | Feed',
            posts
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// --- PEOPLE DISCOVERY PAGE ---
app.get('/explore', isAuthenticated, async (req, res) => {
    try {
        const searchQuery = req.query.search || '';
        let query = { _id: { $ne: req.user._id } };

        if (searchQuery) {
            query.username = { $regex: searchQuery,$options: 'i' };
        }

        const users = await User.find(query);

        res.render('explore', {
            users,
            searchQuery
        });
    } catch (err) {
        console.error('Explore error:', err);
        res.status(500).send('Server Error');
    }
});

// --- SINGLE USER PROFILE PAGE ---
app.get('/users/:id', isAuthenticated, async (req, res) => {
    try {
        const profileUser = await User.findById(req.params.id);
        if (!profileUser) return res.status(404).send('User not found');

        const userPosts = await Post.find({ author: profileUser._id })
            .populate('author', 'username avatar')
            .populate('comments.user', 'username avatar')
            .sort({ createdAt: -1 });

        res.render('profile', {
            profileUser,
            posts: userPosts
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// --- FOLLOW / UNFOLLOW ---
app.post('/users/:id/follow', isAuthenticated, async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const currentUserId = req.user._id;

        if (targetUserId !== currentUserId.toString()) {
            await User.findByIdAndUpdate(currentUserId, { $addToSet: { following: targetUserId } });
            await User.findByIdAndUpdate(targetUserId, { $addToSet: { followers: currentUserId } });
        }
       res.redirect(req.get('Referrer') || '/');
    } catch (err) {
        console.error(err);
       res.redirect(req.get('Referrer') || '/');
    }
});

app.post('/users/:id/unfollow', isAuthenticated, async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const currentUserId = req.user._id;

        await User.findByIdAndUpdate(currentUserId, { $pull: { following: targetUserId } });
        await User.findByIdAndUpdate(targetUserId, { $pull: { followers: currentUserId } });

       res.redirect(req.get('Referrer') || '/');
    } catch (err) {
        console.error(err);
        res.redirect(req.get('Referrer') || '/');
    }
});

// --- POSTS & LIKES & COMMENTS ---
app.post('/posts', isAuthenticated, async (req, res) => {
    try {
        const { content, imageUrl } = req.body;
        if (!content.trim()) return res.redirect('/');

        await Post.create({
            author: req.user._id,
            content,
            imageUrl: imageUrl || ''
        });
        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.redirect('/');
    }
});

app.post('/posts/:id/like', isAuthenticated, async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) return res.redirect('back');

        const userId = req.user._id;
        const hasLiked = post.likes.some(id => id.toString() === userId.toString());

        if (hasLiked) {
            post.likes.pull(userId);
        } else {
            post.likes.push(userId);
        }

        await post.save();
        res.redirect(req.get('Referrer') || '/');
    } catch (err) {
        console.error('Like error:', err);
       res.redirect(req.get('Referrer') || '/');
    }
});

app.post('/posts/:id/comment', isAuthenticated, async (req, res) => {
    try {
        const { text } = req.body;
        if (!text.trim()) return res.redirect('back');

        const post = await Post.findById(req.params.id);
        if (post) {
            post.comments.push({ user: req.user._id, text });
            await post.save();
        }
        res.redirect(req.get('Referrer') || '/');
    } catch (err) {
        console.error(err);
       res.redirect(req.get('Referrer') || '/');
    }
});

// MongoDB Connection & Server Start
const MONGO_URI = 'mongodb+srv://nishashehzad5_db_user:iVI8QZB1V9uBSIat@cluster0.3wnvds3.mongodb.net/connectify_db?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log('⚡ Connected to MongoDB Atlas!');
        app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
    })
    .catch(err => console.error('❌ Connection Error:', err));