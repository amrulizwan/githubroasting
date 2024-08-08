const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const rateLimiter = new RateLimiterMemory({
  points: 5,
  duration: 60,
});

app.use(express.json());
app.use(cors());

app.get('/api/github-roasting', async (req, res) => {
  const username = req.query.username;

  if (!username) {
    return res.status(400).json({ message: 'Username is required' });
  }

  const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

  if (clientIp) {
    try {
      await rateLimiter.consume(clientIp);
    } catch (error) {
      return res.status(429).json({ message: 'Too many requests, try again later.' });
    }
  } else {
    return res.status(400).json({ message: 'Client IP is invalid.' });
  }

  try {
    const profile = await getGitHubProfile(username);
    const prompt = generatePrompt(profile, username);
    const roasting = await generateRoasting(prompt);
    return res.json({ roasting });
  } catch (error) {
    console.error('Error generating roast:', error);
    return res.status(500).json({ message: 'Error generating roast' });
  }
});

async function getGitHubProfile(username) {
  const headers = process.env.GITHUB_TOKEN ? { Authorization: `token ${process.env.GITHUB_TOKEN}` } : {};
  let profileResponse, repoResponse, readmeResponse;

  try {
    profileResponse = await axios.get(`https://api.github.com/users/${username}`, { headers });
    repoResponse = await axios.get(`https://api.github.com/users/${username}/repos?sort=updated`, { headers });
    readmeResponse = await axios.get(`https://raw.githubusercontent.com/${username}/${username}/main/README.md`, { headers });
  } catch (error) {
    try {
      profileResponse = await axios.get(`https://api.github.com/users/${username}`);
      repoResponse = await axios.get(`https://api.github.com/users/${username}/repos?sort=updated`);
      readmeResponse = await axios.get(`https://raw.githubusercontent.com/${username}/${username}/master/README.md`);
    } catch (e) {
      throw new Error('Error fetching GitHub data');
    }
  }

  return {
    name: profileResponse.data.name,
    bio: profileResponse.data.bio,
    company: profileResponse.data.company,
    location: profileResponse.data.location,
    followers: profileResponse.data.followers,
    following: profileResponse.data.following,
    public_repos: profileResponse.data.public_repos,
    created_at: profileResponse.data.created_at,
    updated_at: profileResponse.data.updated_at,
    repositories: repoResponse.data
      .map((repo) => ({
        name: repo.name,
        description: repo.description,
        language: repo.language,
        stargazers_count: repo.stargazers_count,
        open_issues_count: repo.open_issues_count,
        license: repo.license ? repo.license.name : null,
        fork: repo.fork,
        created_at: repo.created_at,
        updated_at: repo.updated_at,
      }))
      .slice(0, 50),
    readme: readmeResponse ? readmeResponse.data : 'README.md not found',
  };
}

function generatePrompt(profile, username) {
  let prompt = `Provide a long, harsh, and sarcastic roast for the GitHub profile of ${username}. Details: "${JSON.stringify(profile)}" (Respond 2 paragraph in Bahasa Indonesia and avoid praise or advice)`;

  if (profile.readme) {
    prompt += `, Profile Markdown: \`\`\`${profile.readme}\`\`\``;
  } else {
    prompt += `, Profile Markdown: Not Found`;
  }

  return prompt;
}

async function generateRoasting(prompt) {
  const safetySettings = [
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
  ];

  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    safetySettings,
  });

  const result = await model.generateContent(prompt);
  const response = await result.response.text();
  return response;
}

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
