import axios from 'axios';
import { Platform } from 'react-native';

const baseURL = Platform.OS === 'web'
  ? 'http://localhost:3001/api'
  : 'http://192.168.1.198:3001/api';

const client = axios.create({ baseURL });

export default client;