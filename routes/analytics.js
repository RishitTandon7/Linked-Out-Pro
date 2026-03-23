// routes/analytics.js — Real LinkedIn analytics via Social Actions API
const express = require('express');
const axios   = require('axios');
const { requireAuth } = require('../middleware/auth');
const { IS_SUPABASE, supabase: sb, get, all } = require('../database/db');

const router = express.Router();
const LI_BASE = 'https://api.linkedin.com/v2';

// Build Axios headers for LinkedIn API
const liHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  'X-Restli-Protocol-Version': '2.0.0',
  'LinkedIn-Version': '202304'
});

/**
 * Fetch social actions (likes + comments) for a single ugcPost URN.
 * LinkedIn Social Actions API: GET /v2/socialActions/{encoded-urn}
 */
async function getSocialActions(token, postUrn) {
  try {
    const encoded = encodeURIComponent(postUrn);
    const res = await axios.get(`${LI_BASE}/socialActions/${encoded}`, {
      headers: liHeaders(token),
      timeout: 8000
    });
    return {
      likes:    res.data?.likesSummary?.totalLikes    ?? 0,
      comments: res.data?.commentsSummary?.totalFirstLevelComments ?? 0
    };
  } catch (e) {
    // If the post is too old or scope missing, silently return 0
    return { likes: 0, comments: 0 };
  }
}

/**
 * Fetch the user's recent UGC posts directly from LinkedIn.
 * GET /v2/ugcPosts?q=authors&authors=List(urn:li:person:{id})
 */
async function getLinkedInPosts(token, linkedinId, count = 10) {
  try {
    const urn = `urn:li:person:${linkedinId}`;
    const res = await axios.get(`${LI_BASE}/ugcPosts`, {
      params: {
        q: 'authors',
        authors: `List(${encodeURIComponent(urn)})`,
        count,
        start: 0
      },
      headers: liHeaders(token),
      timeout: 10000
    });
    return res.data?.elements || [];
  } catch (e) {
    return [];
  }
}

/**
 * GET /api/analytics/live
 * Returns real engagement data, pulling from LinkedIn's Social Actions API
 * for posts we've published via the app, plus any recent LinkedIn posts.
 */
router.get('/live', requireAuth, async (req, res) => {
  try {
    // Get user credentials
    let user = null;
    if (IS_SUPABASE) {
      const { data } = await sb.from('users').select('*').eq('id', req.user.id).single();
      user = data;
    } else {
      user = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    }

    if (!user?.access_token) {
      return res.json({ error: 'no_token', posts: [], totals: { likes: 0, comments: 0, posts: 0 } });
    }

    const token     = user.access_token;
    const linkedinId = user.linkedin_id;

    // 1. Get our published posts that have a linkedin_post_id stored
    let ourPosts = [];
    if (IS_SUPABASE) {
      const { data } = await sb.from('posts')
        .select('id, post_text, hashtags, linkedin_post_id, published_at, intent')
        .eq('user_id', req.user.id)
        .eq('status', 'published')
        .not('linkedin_post_id', 'is', null)
        .order('published_at', { ascending: false })
        .limit(20);
      ourPosts = data || [];
    } else {
      ourPosts = await all(
        `SELECT id, post_text, hashtags, linkedin_post_id, published_at, intent
         FROM posts WHERE user_id = ? AND status = 'published' AND linkedin_post_id IS NOT NULL
         ORDER BY published_at DESC LIMIT 20`,
        [req.user.id]
      );
    }

    // 2. Fetch real engagement for each of our published posts (parallel)
    const enriched = await Promise.all(ourPosts.map(async (post) => {
      const actions = await getSocialActions(token, post.linkedin_post_id);
      return {
        id:           post.id,
        post_text:    post.post_text,
        hashtags:     post.hashtags,
        published_at: post.published_at,
        intent:       post.intent,
        urn:          post.linkedin_post_id,
        likes:        actions.likes,
        comments:     actions.comments,
        engagement:   actions.likes + actions.comments
      };
    }));

    // 3. Also try to get LinkedIn's own view of recent posts (for any posts created natively on LinkedIn)
    const liPosts = await getLinkedInPosts(token, linkedinId, 10);
    const liExtra = await Promise.all(
      liPosts
        .filter(lp => !enriched.some(p => p.urn === lp.id)) // skip ones we already have
        .slice(0, 5)
        .map(async (lp) => {
          const actions = await getSocialActions(token, lp.id);
          const text = lp.specificContent?.['com.linkedin.ugc.ShareContent']?.shareCommentary?.text || '';
          return {
            id:           lp.id,
            post_text:    text,
            hashtags:     '',
            published_at: Math.floor(lp.created?.time / 1000) || null,
            intent:       'linkedin_native',
            urn:          lp.id,
            likes:        actions.likes,
            comments:     actions.comments,
            engagement:   actions.likes + actions.comments,
            native:       true
          };
        })
    );

    const allPosts = [...enriched, ...liExtra].sort((a, b) => b.engagement - a.engagement);

    const totals = allPosts.reduce((acc, p) => ({
      likes:    acc.likes    + p.likes,
      comments: acc.comments + p.comments,
      posts:    acc.posts    + 1
    }), { likes: 0, comments: 0, posts: 0 });

    res.json({
      posts:  allPosts,
      totals,
      meta: {
        note: 'Views are not available via LinkedIn personal API. Showing real likes + comments.',
        fetchedAt: new Date().toISOString()
      }
    });

  } catch (e) {
    console.error('Analytics error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
