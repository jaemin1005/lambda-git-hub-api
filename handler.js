const { MongoClient } = require("mongodb");

const MONGODB_URI = process.env.MONGODB_URI;
let client;

async function connectToMongo() {
  if (!client) {
    client = await MongoClient.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  }
  return client.db(process.env.MONGODB_DATABASE);
}

exports.handler = async (event) => {
  const { Octokit } = await import("@octokit/rest").then((module) => module);
  const octokit = new Octokit({ auth: process.env.GIT_TOKEN });
  const db = await connectToMongo();
  const collection = db.collection(process.env.MONGODB_COLLECTION);

  try {
    const repositories = await octokit.paginate(
      octokit.rest.repos.listForUser,
      {
        username: process.env.GIT_USER_NAME,
        per_page: 100,
      }
    );

    const allRepoData = [];

    for (const repo of repositories) {
      const repoName = repo.name;
      const owner = repo.owner.login;

      if (repo.size == 0) continue;

      const commits = await octokit.paginate(octokit.rest.repos.listCommits, {
        owner,
        repo: repoName,
        per_page: 100,
      });

      const repoData = {
        _id: repo.id,
        name: repoName,
        html_url: repo.html_url,
        created_at: repo.created_at ?? null,
        updated_at: repo.updated_at ?? null,
        commits: commits.map((commit) => ({
          sha: commit.sha,
          message: commit.commit.message,
          html_url: commit.html_url,
          create_at: commit.commit.author?.date ?? null,
        })),
      };

      await collection.updateOne(
        { _id: repoData._id },
        { $set: repoData },
        { upsert: true } // upsert를 true로 설정하여 자동 삽입 또는 업데이트
      );
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "데이터 저장 성공",
        repositories: allRepoData,
      }),
    };
  } catch (error) {
    console.error("데이터를 가져오는 중 오류 발생:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "서버 오류 발생", error: error.message }),
    };
  }
};
