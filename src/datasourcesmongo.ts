

// // Use our automatically generated USER and AddUserMutationResponse types
// // for type safety in our data source class
// // import { objectEnumValues } from "@prisma/client/runtime/library";
import { User, AddUserMutationResponse, SignupMutationResponse, CampaignMutationResponse, Campaign } from "./__generated__/resolvers-types";

// // const UsersDB: Omit<Required<User>, "__typename">[] = usersData;

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

export class DataSourcesMongo {

  async getUsers(): Promise<User[]> {
    // console.log("getUsers: prisma findMany")
    const users = await prisma.user.findMany({})
    // console.table(users)
    return users;
  }

  async getUserByName(name: string): Promise<User> {
    console.log("in getUserByName")
    console.log(name)
    const user = prisma.user.findUnique({where: {name: name}});
    // return user;
    return null;
  }
  
  async getUserByEmail(email: string): Promise<User> {
    console.log("in getUserByEmail")
    console.log(email)
    const user = prisma.user.findUnique({where: {email: email}});
    // return user;
    return null;
  }

  async createCampaign(authorId: string, campaign: Campaign): Promise<CampaignMutationResponse> {
    console.table(campaign)

    const result = await prisma.user.update({
      where: {
        id: authorId,
      },
      data: {
        campaigns: {
          createMany: {
            // data: [{ title: 'My 3rd campaign' }],
            data: [{ title: campaign.title }],
            // data: [campaign],
          },
        },
      },
      include: {
        campaigns: true,
      } 
    })
      
    return {
      code: "200",
      success: true,
      message: "Campaign created!",
      campaign,
    }
  }

  async getUserById(id: string): Promise<User> {
    console.log("in getUser")
    console.log(id)
    const user = prisma.user.findUnique({where: {id: id}});
    // const user = prisma.user.findUnique({where: {id: "651efe317ef84f6cd52a4476"}});
    // const user = prisma.user.findUnique({where: {name: name}});
    // return user;
    return null;
  }

  async addUser(user: User): Promise<AddUserMutationResponse> {
    await prisma.user.create({
      data: {
        name: user.name,
        email: user.email,
        password: user.password
      },
    })

    // if (user.name) {
    //   prisma.user.create({
    //     email: user.email,
    //     name: user.name,
    //     password: user.password
    //   });

    return {
      code: "200",
      success: true,
      message: "New user added!",
      user,
    }
    // } else {
    //   return {
    //     code: "400",
    //     success: false,
    //     message: "Invalid input",
    //     user: null,
    //   };
    // }
  }

  async signup(user: User): Promise<SignupMutationResponse> {
    await prisma.user.create({
      data: user,
    })
    return {
      code: "200",
      success: true,
      message: "New user created!",
      user: { ...user, password: "********" },
    }
    // } else {
    //   return {
    //     code: "400",
    //     success: false,
    //     message: "Invalid input",
    //     user: null,
    //   };
    // }
  }

}
