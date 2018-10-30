import { GraphQLModule } from '@graphql-modules/core';
import { Users } from './providers/users';
import resolvers from './resolvers';
import gql from 'graphql-tag';
// imports { BlogModule } from '../blog';

export const UserModule = new GraphQLModule({
  name: 'User',
  providers: [Users],
  // if I add here [BlogModule], the all getter functions will have an infinite loop ( it is not related to ES imports )
  // imports: [BlogModule]
  resolvers,
  typeDefs: gql`
    type User {
      id: String
      username: String
    }

    type Query {
      users: [User]
      user(id: Int!): User
    }
  `,
});
