const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  BatchWriteCommand,
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);

const REPO_TABLE = process.env.REPO_TABLE; // DynamoDB 테이블 이름을 환경 변수로 설정

exports.handler = async (event) => {
  const { Octokit } = await import("@octokit/rest").then((module) => module);
  const octokit = new Octokit({ auth: process.env.GIT_TOKEN });

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

      // 데이터 파싱
      allRepoData.push({
        id: repo.id,
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
      });
    }

    const chunkSize = 25;
    for (let i = 0; i < allRepoData.length; i += chunkSize) {
      const chunk = allRepoData.slice(i, i + chunkSize).map((item) => ({
        PutRequest: {
          Item: item,
        },
      }));
      
      const params = {
        RequestItems: {
          [REPO_TABLE]: chunk,
        },
      };
      
      await docClient.send(new BatchWriteCommand(params));
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
